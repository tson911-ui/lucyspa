# LUCY SPA --- PRODUCT REQUIREMENTS DOCUMENT (PRD)

**Document:** `LUCY_SPA_PRD.md`\
**Status:** Requirement Freeze --- V1\
**Product:** Lucy Spa Management & Customer WebApp\
**Primary market:** Vietnam\
**Primary language:** Vietnamese\
**Secondary language:** English\
**Architecture goal:** Web-first, multi-branch-ready, mobile-ready,
e-commerce-ready\
**Audience:** Product owner, Codex/coding agent, developers, testers

------------------------------------------------------------------------

## 1. Product Vision

Lucy Spa is a web-based operating system for a spa business, not merely
a marketing website.

The system must support:

-   Public spa website and service/product discovery.
-   Customer membership and authentication.
-   Online booking and queue/availability management.
-   Employee/KTV management, skills, attendance, leave and service
    execution.
-   Walk-in and member visits.
-   POS, invoices, cash and PayOS-ready payments.
-   Service packages/combos.
-   Loyalty points, birthday rewards, referrals and reward entitlements.
-   Product catalog, inventory and cosmetic sales.
-   Product website importer for authorized source content and images.
-   Service tour compensation, product commissions, tips and payroll.
-   Cash-safe closing.
-   Owner/manager dashboards and reporting.
-   Fine-grained permissions and immutable audit history.
-   Multi-branch architecture from V1.
-   Future mobile apps and online cosmetic ordering without redesigning
    the core domain.

The application must favor configurable business rules over hard-coded
values.

------------------------------------------------------------------------

## 2. Product Principles

1.  **Owner-controlled configuration:** prices, service durations,
    tours, commissions, promotions, packages, rewards, permissions and
    similar business settings should be editable from the Dashboard
    where practical.
2.  **Historical accuracy:** changes made today must never silently
    alter historical invoices, compensation or inventory records.
3.  **No destructive financial history:** financial and operational
    ledgers are corrected through explicit adjustments, voids or
    reversals rather than deletion.
4.  **Backend authorization:** hiding a button in the UI is not
    sufficient. Every protected action must be authorized server-side.
5.  **Auditability:** sensitive changes record actor, time and
    before/after values.
6.  **No invented policies:** requirements marked TBD/Future must not be
    implemented using assumptions.
7.  **Progressive delivery:** build and validate one phase before moving
    to the next.
8.  **Multi-branch by design:** V1 may operate one branch, but core
    operational records must support branches.
9.  **Configuration over code changes:** routine business changes should
    not require editing source code.
10. **Customer simplicity:** public and customer-facing workflows should
    remain simple even when internal accounting is detailed.

------------------------------------------------------------------------

## 3. V1 Scope and Future Scope

### 3.1 V1 Core

V1 includes:

-   Public website.
-   Vietnamese/English UI foundation.
-   Authentication and member accounts.
-   Owner/employee accounts and RBAC.
-   Branch foundation.
-   Services and internal durations.
-   Employee skills.
-   Booking, availability and queue.
-   Employee attendance and leave.
-   Visits and service Start/End workflow.
-   Walk-in handling.
-   POS and invoices.
-   Cash, PayOS-ready and split-payment architecture.
-   Discounts/vouchers.
-   Combos.
-   Loyalty points.
-   Birthday point multiplier.
-   Referrals.
-   Reward catalog/entitlements.
-   Product catalog and variants.
-   Product POS sales.
-   Inventory, stock receipts and adjustments.
-   Product returns workflow.
-   Service tours.
-   Product commissions.
-   Tips.
-   Payroll.
-   Cash-safe management.
-   Owner/manager dashboards.
-   Reports and Excel/PDF exports.
-   Notification center.
-   Audit log.
-   Backup/restore strategy.
-   Bulk product import/update.
-   Authorized website product/content/image importer.

### 3.2 Future / TBD

Prepare the architecture, but do not invent business rules for:

-   Full online product checkout and shipping.
-   Shipping fees.
-   Shipping carriers.
-   COD.
-   Free-shipping thresholds.
-   Delivery SLA and failed-delivery policy.
-   Zalo integration details.
-   Native push notifications.
-   Native iOS/Android apps.
-   Exact physical payment-speaker integration.
-   Electronic invoice/VAT integrations unless separately specified.
-   Additional branches beyond the initial branch.

------------------------------------------------------------------------

## 4. Branding and Public Website

### 4.1 Visual Direction

Lucy Spa should feel:

-   Luxurious.
-   Elegant.
-   Soft.
-   Feminine.
-   Warm.
-   Simple and easy to operate.

Primary visual direction: **red + gold**.

The final logo, imagery and exact design tokens will be supplied later.
UI implementation must allow branding assets to be replaced without
structural changes.

### 4.2 Public Website

Provide:

-   Home page.
-   Service discovery.
-   Product discovery/catalog foundation.
-   Promotional popup on entry; user can dismiss it.
-   Vietnamese/English language selector.
-   Contact/business information area.
-   Member registration/login entry points.
-   Booking entry point.

Service durations are **internal scheduling data** and must not be shown
on the public service menu.

### 4.3 Business Hours

Default initial operating hours:

**09:00--21:00, no lunch break.**

Operating hours must ultimately be configurable per branch.

Booking logic should prevent impossible schedules. By default, a service
should not be offered at a start time that would make its estimated
completion exceed branch closing time unless an authorized business rule
later allows it.

------------------------------------------------------------------------

## 5. Branch Model

Create a `Branch` domain from V1 even if only one branch exists
initially.

Examples of branch-scoped data:

-   Employees.
-   Employee assignments.
-   Bookings.
-   Visits.
-   Inventory.
-   Stock movements.
-   Cash register/safe.
-   Revenue reporting.
-   Operational notifications.

Owner can view all branches. Managers may be limited to assigned
branches through permissions/scope.

Do not hard-code the initial physical address into business logic.

------------------------------------------------------------------------

## 6. Identity, Authentication and Customer Accounts

### 6.1 Customer Registration

Required fields:

-   Full name.
-   Date of birth.
-   Address.
-   Email.
-   Phone.
-   Password.

Email and phone must be unique.

### 6.2 Activation

Registration flow:

1.  Customer submits registration.
2.  System generates a random 6-digit OTP.
3.  OTP is sent to the registered email.
4.  Customer enters the correct OTP.
5.  Account becomes active.

OTP must have:

-   Expiration; initial recommendation: 5 minutes, configurable where
    appropriate.
-   Attempt limits.
-   Resend throttling/rate limiting.
-   Secure storage/verification.

### 6.3 Password Security

-   Passwords must never be stored in plaintext.
-   Use a reputable password hashing algorithm/library.
-   Staff, managers and Owner must never be able to retrieve a
    customer's password.
-   Enforce a reasonable password policy.

### 6.4 Forgot Password

Use verification/reset flow:

`Request reset → email OTP/token verification → set new password`

Never email a default or existing password.

### 6.5 Updating Email or Phone

Sensitive identity changes require verification. OTP verification must
be used as appropriate before completing changes.

### 6.6 Customer Account Area

Customer can view relevant:

-   Profile.
-   Booking history.
-   Service history.
-   Payment/invoice history.
-   Points balance/history.
-   Combo balance/history.
-   Rewards.
-   Referral information.
-   Notifications.

Employees do not log into customer accounts.

Authorized staff may search necessary customer service information using
phone/email, subject to permissions.

------------------------------------------------------------------------

## 7. Employee Accounts, Roles and Permissions

### 7.1 Employee Creation

Employee accounts are not publicly registrable.

Owner, or an authorized manager, creates employees.

Initial employee information includes:

-   Full name.
-   Date of birth.
-   Employee ID.
-   Phone.
-   Address.
-   Branch assignment.
-   Skills.
-   Base salary.
-   Role.
-   Granular permissions.
-   Active/inactive status.

When employment ends, mark employee `INACTIVE`. Do not delete historical
employee identity.

### 7.2 Suggested Roles

Role names may include:

-   `OWNER`
-   `SENIOR_MANAGER`
-   `TEAM_LEADER`
-   `STAFF` / `KTV`

Roles are permission bundles; sensitive behavior must use granular
permissions.

Example permissions:

-   `VIEW_REVENUE`
-   `VIEW_ALL_CUSTOMERS`
-   `MANAGE_EMPLOYEES`
-   `MANAGE_SKILLS`
-   `MANAGE_SERVICE_PRICES`
-   `MANAGE_PRODUCT_PRICES`
-   `MANAGE_TOURS`
-   `MANAGE_COMMISSIONS`
-   `MANAGE_DISCOUNTS`
-   `CREATE_VOUCHERS`
-   `APPLY_DISCOUNTS`
-   `MANAGE_INVENTORY`
-   `APPROVE_STOCK_RECEIPTS`
-   `MANAGE_RETURNS`
-   `MANAGE_PAYROLL`
-   `MANAGE_CASH`
-   `APPROVE_LEAVE`
-   `MANAGE_PERMISSIONS`
-   `VIEW_AUDIT_LOG`
-   `EXPORT_REPORTS`

Exact permission names can be refined during implementation, but
permission semantics must remain granular.

### 7.3 Owner Protection

There is one highest-level Owner account.

No other account may:

-   Demote Owner.
-   Lock Owner.
-   Deactivate Owner.
-   Delete Owner.
-   Modify Owner's top-level permissions.

Only Owner may perform authorized actions affecting their own top-level
account. Destructive sole-owner deletion should not be implemented.

Protect Owner invariants in both UI and backend/domain logic.

------------------------------------------------------------------------

## 8. Services

### 8.1 Service Configuration

Services must be managed from Dashboard.

Suggested fields:

-   ID.
-   Code/SKU-like service code.
-   Vietnamese name.
-   English name.
-   Category.
-   Description.
-   Public price.
-   Internal estimated duration.
-   Active status.
-   Eligible skills.
-   Tour configuration.
-   Point eligibility.
-   Branch availability where applicable.

### 8.2 Initial Internal Duration Rules

These are scheduling estimates and must not be public menu labels:

-   Gội đầu dưỡng sinh: 90 minutes.
-   Gội thường: configurable 30--45 minutes.
-   Gội cao cấp: configurable 30--45 minutes.
-   Facial/skin service: configurable 60--90 minutes.
-   Nail: configurable 60--120 minutes.
-   Massage cổ vai gáy: 60 minutes.
-   Foot massage: 30-minute and 60-minute options.

These values must be editable rather than hard-coded.

### 8.3 Price Authority

KTV cannot enter arbitrary service prices.

KTV selects a service and sees the configured system price.

Only Owner or a sufficiently authorized high-level manager can change
service prices.

All price changes must be audited.

------------------------------------------------------------------------

## 9. Employee Skills and Availability

Employees are assigned skills.

Example:

-   Hair wash.
-   Dưỡng sinh.
-   Facial.
-   Massage.
-   Nail.

Booking suggestions must filter employees using at least:

1.  Required skill.
2.  Branch assignment.
3.  Active employment status.
4.  Checked-in/working status where applicable.
5.  Approved leave.
6.  Existing bookings.
7.  Current service state.
8.  Queue/availability.

Suggested operational statuses:

-   `AVAILABLE`
-   `BOOKED`
-   `IN_SERVICE`
-   `BREAK`
-   `ON_LEAVE`
-   `OFFLINE`

Prefer deriving status automatically from operational events rather than
relying only on manual status toggles.

------------------------------------------------------------------------

## 10. Attendance and Leave

### 10.1 Attendance

Employees use:

-   `Bắt đầu ngày làm việc` / Check-in.
-   `Kết thúc ngày làm việc` / Check-out.

Store timestamps for future attendance/payroll reporting.

V1 should record attendance accurately. Do not automatically invent
salary deduction formulas for lateness/absence unless Owner configures
them later.

### 10.2 Leave

Flow:

`Employee request → Manager/Owner approve or reject`

Leave request includes:

-   Date/range.
-   Reason.
-   Status.
-   Approver.
-   Decision timestamp.

Approved leave:

-   Makes employee unavailable for booking.
-   Updates operational status.
-   Triggers conflict checks.

If future bookings conflict:

-   Notify customer.
-   Notify manager.
-   Offer qualified replacement suggestions.
-   Customer may choose a suggested KTV or manually choose another
    qualified KTV.
-   Do not silently cancel.

Manager can reassign KTV where permitted.

Record old KTV, new KTV, actor and timestamp.

------------------------------------------------------------------------

## 11. Booking and Availability

### 11.1 Member Booking

Online booking requires an activated member account.

Customer may:

-   Select one or multiple services.
-   Select a specific KTV.
-   Select `Nhân viên bất kỳ`.
-   Make multiple bookings on the same day if they do not conflict.
-   Book future appointments within a configurable maximum booking
    horizon.
-   Cancel bookings.

### 11.2 Any-Employee Selection

For `Nhân viên bất kỳ`, choose/suggest the qualified employee with the
best suitable/earliest availability based on skills and operational
schedule.

Do not assign an unqualified KTV.

### 11.3 Multiple Services

If one customer selects multiple services for the same KTV, estimated
durations accumulate sequentially.

If multiple KTV are used, schedules must be calculated per employee.

A single visit/invoice may contain multiple KTV.

### 11.4 Busy KTV

Customer should see useful availability information such as:

-   Estimated time until KTV becomes available.
-   Number of customers waiting where applicable.
-   Suggested suitable time.

Do not expose private information about other customers.

### 11.5 Booking Confirmation

If requested staff/time is valid and available, booking can
auto-confirm.

### 11.6 Cancellation

Customer may cancel in app.

If cancellation occurs less than **15 minutes** before appointment,
generate a specific late-cancellation notification for manager.

No automatic point penalty or account punishment is currently required.

### 11.7 Late Arrival / No Show

Hold booked slot for **20 minutes**.

After 20 minutes without arrival:

-   Manager may cancel/no-show the booking.
-   Active slot may be released.
-   Next waiting customer can be advanced.

No automatic point deduction or penalty.

------------------------------------------------------------------------

## 12. Walk-In, Guests and Family

Support:

1.  Registered member booking/visit.
2.  Existing member identified by phone/email at spa.
3.  Walk-in guest without member account.
4.  Child under 18 without a phone/member account.
5.  Family/relative service participation.

Staff must not create a normal adult member account on behalf of the
customer. Adult customers should register themselves.

For a child/guest, create a visit participant/guest representation
without requiring a full member login.

The domain should distinguish:

-   Account owner/payer.
-   Visit participant/service recipient.
-   Combo owner.
-   KTV assigned to each service line.

This avoids forcing every family member into the same customer identity.

------------------------------------------------------------------------

## 13. Visit and Service Execution

Suggested visit lifecycle:

`BOOKED → ARRIVED → IN_SERVICE → COMPLETED → PAID`

Additional cancellation/no-show states may be represented explicitly.

### 13.1 Arrival

When customer arrives, staff finds booking/visit and marks `ARRIVED`.

### 13.2 Start/End

Before performing service, KTV must press `START`.

At completion, KTV must press `END`.

Store actual start/end timestamps.

### 13.3 Five-Minute Warning

If expected operational Start/End action is delayed by **5 minutes**,
notify:

-   KTV.
-   Manager.

Exact warning trigger should be implemented from scheduling/service
state, not arbitrary polling assumptions.

### 13.4 Cannot Accept Next Customer Before End

If KTV has not ended the current service, they remain occupied and
**must not be assigned/allowed to accept the next customer**.

The system must not auto-end a service.

Manager may resolve exceptional forgotten-state situations with
permission and audit history.

### 13.5 Add Service on Behalf of Customer

During a visit, KTV may select `Order on behalf of customer` and add an
additional service requested by customer.

KTV:

-   Selects existing service only.
-   Cannot type arbitrary price.
-   Cannot edit configured price.

Record:

-   Added service.
-   Actor employee.
-   Timestamp.
-   Assigned KTV.
-   Snapshot price.
-   Indicator that staff added it on behalf of customer.

------------------------------------------------------------------------

## 14. POS and Invoice

### 14.1 Invoice Contents

Before payment, show:

-   Service lines.
-   Service recipients where relevant.
-   KTV per service.
-   Staff-added services.
-   Product lines.
-   Product seller attribution.
-   Combo/reward usage.
-   Discounts/vouchers.
-   Tips.
-   Payment breakdown.
-   Total.

A combo/reward service may appear as a consumed entitlement with `0đ`
customer charge where appropriate.

### 14.2 Snapshot Rule

Invoice/order lines must snapshot transaction-time data needed for
historical integrity, including as applicable:

-   Product/service name.
-   Price.
-   Discount.
-   Tax fields if later introduced.
-   Tour amount/rule result.
-   Commission amount/rule result.
-   Employee attribution.

Future configuration changes must not retroactively alter historical
records.

### 14.3 Invoice Statuses

Use explicit statuses such as:

-   `DRAFT`
-   `PENDING_PAYMENT`
-   `PAID`
-   `CANCELLED`
-   `REFUNDED` where applicable.

Do not allow ordinary KTV to convert `PAID` back to `UNPAID`.

------------------------------------------------------------------------

## 15. Payments

### 15.1 Supported Architecture

V1 payment model must support:

-   Cash.
-   PayOS-ready bank transfer.
-   Split payment.

Future payment methods can be added without redesigning invoices.

### 15.2 Cash

KTV may collect cash for their customer.

POS should allow:

-   Amount received.
-   Total due.
-   Change calculation.
-   Confirm payment.

Cash is deposited into spa safe/register.

### 15.3 PayOS

Prepare a proper integration boundary for PayOS.

Desired future/implementation flow:

`Create payment request/QR → Pending → provider confirmation/webhook → validate → PAID`

Payment confirmation must not depend only on staff manually claiming a
transfer occurred.

Implementation must use:

-   Provider transaction/reference IDs.
-   Signature/authenticity verification according to current PayOS
    documentation when integration is implemented.
-   Idempotent webhook processing.
-   Duplicate-event protection.
-   Payment reconciliation status.

Credentials must be stored securely and never committed to source
control.

### 15.4 Split Payment

One invoice can be paid using multiple payment components, e.g.:

`Cash 200,000 + PayOS 300,000`.

Total successful payment components must reconcile to amount due.

### 15.5 No Debt

No customer credit/pay-later flow is required.

------------------------------------------------------------------------

## 16. Discounts and Vouchers

Support configurable:

-   Percentage discount.
-   Fixed-amount discount.
-   Start/end time.
-   Minimum spend.
-   Applicable products/services/categories.
-   Usage limit.
-   Active status.
-   Early termination.

Voucher creation is Owner-controlled.

Managers may apply/manage discount functionality only with explicit
permission.

Discount application must be audited when sensitive/manual.

------------------------------------------------------------------------

## 17. Service Combos / Packages

### 17.1 Current Business Examples

Examples include:

-   Pay 5 sessions, receive 1 bonus → 6 total.
-   Pay 10 sessions, receive 2 bonus → 12 total.

Applicable to a specific service type.

Do not hard-code only these two packages.

### 17.2 Package Configuration

Owner can configure:

-   Package name.
-   Service.
-   Paid sessions.
-   Bonus sessions.
-   Package price.
-   Active status.
-   Point eligibility/rules if needed.
-   Expiry mode.

Current Lucy Spa rule: **combos have no expiry**.

Architecture may retain configurable expiry support for future packages,
but existing/default Lucy Spa combos should be non-expiring.

### 17.3 Service Restriction

A package bought for one service cannot be consumed for a different
service.

### 17.4 Family Use

Package belongs to purchaser/member.

A relative may consume a session by providing purchaser phone number to
staff.

Staff identifies the owner and records whether usage is:

-   Owner.
-   Relative/family.

Store:

-   Package owner.
-   Service recipient/relationship marker where appropriate.
-   Date/time.
-   Service.
-   KTV.
-   Employee who performed consumption action.

### 17.5 Incorrect Consumption

Ordinary staff cannot delete package history.

Authorized Owner/Manager can create a restoration/adjustment with reason
and audit trail.

### 17.6 No Service Tour on Free Entitlements

A service consumed for free from:

-   Bonus combo session.
-   Free promotional reward.
-   Free service gift.

does **not** generate service tour compensation.

Only a service for which the customer is actually charged under the
applicable paid-service rule generates tour compensation.

------------------------------------------------------------------------

## 18. Loyalty Points

### 18.1 Base Earning Rule

Current rule:

**1,000 VND eligible spend = 1 point**

Cosmetic purchases also earn base points.

Award points only after successful `PAID` transaction.

Calculate on eligible amount actually paid after discount.

**Tips are excluded.**

### 18.2 Points Are Not Currency

Points:

-   Cannot directly reduce invoice amount.
-   Cannot be combined with money as partial payment.
-   Cannot be transferred between customer accounts.

### 18.3 Point Expiry

Use rolling expiration per earned lot.

Current rule:

**Each earned point lot expires 365 days after it is earned.**

Example:

`+500 points on 15/09/2026 → expires 15/09/2027`.

Keep ledger history after expiry.

Do not delete expired point transactions.

### 18.4 Manual Adjustments

Only Owner or sufficiently authorized manager may add/subtract points
manually.

Require:

-   Amount.
-   Reason.
-   Actor.
-   Timestamp.
-   Audit log.

Prefer ledger adjustments rather than overwriting balance.

### 18.5 Membership Tiers

Architecture may support configurable tiers such as:

-   Member.
-   Silver.
-   Gold.
-   Diamond.

Tier activation/business thresholds can be deferred/configured later.

------------------------------------------------------------------------

## 19. Birthday Rewards

Current birthday point rule:

**Base points + 100% birthday bonus = 2× base points.**

Example:

`500,000 VND eligible spend → 500 base + 500 birthday bonus = 1,000 points`.

Birthday bonus applies **only on the customer's date of birth**.

Do not apply it on other days.

Other birthday gifts must be configurable in Dashboard.

If future abuse-prevention limits are desired (e.g. one invoice/day),
they must be configured explicitly rather than invented.

------------------------------------------------------------------------

## 20. Referrals

### 20.1 Referral Identifier

Current Lucy Spa decision:

**Customer phone number is the referral identifier.**

The UI must handle phone data carefully and only expose what is
necessary.

### 20.2 Permanent Referrer

Once a customer has a referrer, that relationship is permanent and
cannot be changed through ordinary flows.

A customer may simultaneously:

-   Have been referred by another customer.
-   Refer additional customers.

Example:

`A → B → C`

B can receive referral benefit for C even though B was originally
referred by A.

### 20.3 Reward Trigger

Referrer receives referral reward only from each referred customer's
**first eligible successful paid transaction**.

There is no ongoing lifetime reward from every future purchase by that
referred customer.

The exact eligible transaction categories/reward formula should be
configurable and must not be guessed if not configured.

------------------------------------------------------------------------

## 21. Reward Catalog and Entitlements

Keep these domains separate:

-   Loyalty Points.
-   Combo Sessions.
-   Vouchers.
-   Reward Gifts/Entitlements.

Owner can configure a reward catalog.

Possible rewards:

-   Free service.
-   Voucher.
-   Product/gift.
-   Other configured entitlement.

A reward entitlement should track:

-   Type.
-   Quantity.
-   Owner/customer.
-   Issued source/campaign.
-   Issued date.
-   Expiry if configured.
-   Redemption history.
-   Status.

Do not mix a free service entitlement into the points balance.

------------------------------------------------------------------------

## 22. Cosmetic Promotions

Architecture must support configurable campaigns.

Examples discussed by Owner include threshold campaigns such as:

-   Cosmetic invoice above a configured threshold → bonus points + free
    facial-related service.
-   Higher threshold → different bonus points + free dưỡng sinh service.

These examples are **not source-code constants**.

Campaign configuration should support:

-   Name.
-   Eligible brand/category/product.
-   First-purchase condition if configured.
-   Minimum eligible spend.
-   Start/end.
-   Bonus points.
-   Reward entitlement.
-   Usage limit.
-   Customer usage limit.
-   Active status.
-   Priority/stacking policy.

If campaign stacking or whether displayed points are "bonus" vs "total"
has not been configured, the system must require an explicit rule rather
than infer one.

------------------------------------------------------------------------

## 23. Product Catalog

### 23.1 Brand-Agnostic Domain

The Whoo is the initial brand, but **do not hard-code The Whoo**.

Model:

`Brand → Category → Product → Variant`

Owner can add future brands/products without code changes.

### 23.2 Product Fields

Support as applicable:

-   Internal ID.
-   SKU.
-   Brand.
-   Category.
-   Product name.
-   Vietnamese description.
-   English description.
-   Images.
-   Variant.
-   Size/volume.
-   Cost price.
-   List price.
-   Promotional price.
-   Promotion schedule.
-   Stock.
-   Low-stock threshold.
-   Active/draft/published status.
-   Source/import metadata.

Variant can have its own:

-   SKU.
-   Price.
-   Stock.
-   Barcode if later needed.

### 23.3 Sensitive Product Data

Cost and profit/margin are restricted to Owner/high-level managers with
permission.

KTV must not see cost price or margin.

### 23.4 Price Authority

KTV may sell products but cannot change product prices.

Only Owner or authorized high-level manager can change:

-   List price.
-   Promotional price.
-   Promotion timing.

Audit price changes.

------------------------------------------------------------------------

## 24. Product Promotions

Support:

-   List price.
-   Promotional price.
-   Start time.
-   End time.
-   Manual early termination.

When promotion is inactive/expired, public sales price returns to the
appropriate normal configured price.

Public UI may show list price crossed out and active promotional price.

------------------------------------------------------------------------

## 25. Product Sales and Employee Attribution

A product invoice may attribute each product line to the employee who
sold/recommended it.

One invoice can contain products attributed to different employees.

Store attribution at line level so commission calculations remain
accurate.

KTV can sell/order products for customer but cannot edit protected
pricing.

------------------------------------------------------------------------

## 26. Product Commission

Product sales commission is separate from service tour.

Support configurable commission:

-   Percentage.
-   Fixed amount.
-   By brand.
-   By category.
-   By product.
-   By employee.
-   Effective date/version.

Commission generated from a historical sale must retain its historical
calculated value even if rules change later.

Approved product return/refund should reverse associated commission
where applicable.

Product commission contributes to spa payroll calculations.

------------------------------------------------------------------------

## 27. Inventory

### 27.1 Stock Receipt

Only Owner or authorized high-level manager can create/approve inventory
receipts.

Receipt may include:

-   Supplier.
-   Branch.
-   Date.
-   Notes.
-   Product/variant.
-   Quantity.
-   Unit cost.
-   Lot/batch.
-   Expiry date.

Confirmed receipt increases stock.

### 27.2 Stock Reduction and Reservation

-   Successful product sale reduces stock.
-   Pending checkout/invoice may reserve stock where necessary.
-   Cancellation releases reservation.
-   Do not oversell unless Owner later enables an explicit controlled
    override.

### 27.3 Low Stock

Configure low-stock threshold per product/variant.

Generate Dashboard notifications.

### 27.4 Lot and Expiry

Architecture supports:

-   Lot/batch.
-   Expiry date.
-   Expiry warnings, e.g. configurable 90-day warning.
-   Earlier-expiring stock prioritization where practical.

### 27.5 Internal Stock Adjustments

Support reasons such as:

-   Spa/internal use.
-   Tester.
-   Damaged.
-   Expired.
-   Loss.
-   Stock count correction.

Require reason.

No revenue is generated for internal adjustments.

### 27.6 Physical Stock Count

Never "fix" stock by silently editing the number.

Example:

`System = 20, Actual = 19`

Create:

`Stock Adjustment = -1`

with reason, actor and audit trail.

------------------------------------------------------------------------

## 28. Product Return Policy

Current policy:

### 28.1 Customer Preference

Return may be considered only when product remains intact with
manufacturer seals/tags/packaging as required.

Customer bears return shipping cost under this reason.

### 28.2 Shipping/Packing Damage or Wrong Product

-   100% replacement within 48 hours of receipt.
-   After 48 hours, this reason is not accepted under the current
    policy.
-   Customer provides photos.
-   Spa covers applicable shipping/exchange costs.

### 28.3 Skin Irritation / Reaction

Handled case-by-case.

Customer should provide relevant photos promptly so spa can assess and
respond.

The software should record the case and evidence; it should not attempt
medical diagnosis.

### 28.4 Return Accounting

When an approved product refund/return occurs, reverse/adjust as
applicable:

-   Money.
-   Base points.
-   Bonus points.
-   Reward entitlement.
-   Product commission.
-   Stock, only if item is actually eligible to return to sellable
    inventory.

Create audit history.

------------------------------------------------------------------------

## 29. Service/Combo Refund Policy

Current Lucy Spa business rule:

**No refunds for services or service combos.**

Do not provide ordinary service/combo refund actions.

Product return/refund remains governed by the cosmetic return policy.

Exceptional future policy changes require explicit Owner
configuration/change request.

------------------------------------------------------------------------

## 30. Website Product Importer

Lucy Spa needs a bulk importer because the authorized distributor
catalog may contain many products.

### 30.1 Purpose

Import authorized product content and images from a source website
without manually creating every product.

The importer must not automatically treat source-site pricing as Lucy
Spa's official price.

### 30.2 Import Pipeline

Required conceptual flow:

`Source Website → Crawl/Extract → Normalize → Draft/Staging → Validate → Duplicate Detection → Preview → Owner Approval → Product Catalog`

Never write unreviewed crawler output directly into production product
records.

### 30.3 Importable Content

Where available and authorized, importer may collect:

-   Product name.
-   Brand.
-   Category.
-   Product description/article content.
-   Usage/content sections.
-   Variants.
-   Product images.
-   Source URL.
-   Source metadata useful for future synchronization.

### 30.4 Images

Download authorized images into Lucy Spa-controlled storage rather than
relying permanently on source-site hotlinks.

Support:

-   Multiple images per product.
-   Image ordering.
-   Import error reporting.
-   Reasonable format/size validation.

### 30.5 Pricing Rule

**Source-site price must not automatically become Lucy Spa's official
selling price.**

After import, Owner/high-level manager sets:

-   Cost price.
-   List price.
-   Promotional price.
-   Stock.
-   Commission where relevant.

A newly imported product may remain `DRAFT` / `PRICE_NOT_SET` and must
not be publicly purchasable until required sales fields are configured.

### 30.6 Re-import / Sync Preview

Future re-import should compare source and local data and present a
preview such as:

-   Unchanged.
-   Content changed.
-   Images changed.
-   New product.
-   Possible duplicate.
-   Source missing.

Never overwrite Lucy Spa-owned business fields such as price, stock,
commission or local merchandising data during content sync.

### 30.7 Import History

Store:

-   Source.
-   Start/end time.
-   Actor.
-   Number discovered.
-   Number valid.
-   Number imported.
-   Number skipped.
-   Errors.
-   Result status.

### 30.8 Source Adapter Design

Do not tightly couple the entire product system to one The Whoo website.

Use an importer/source-adapter abstraction so future authorized sources
can be added.

The exact crawler implementation depends on the actual source website
structure/API and must be assessed when the source URL is provided.

The importer must respect access controls and technical constraints of
the authorized source.

------------------------------------------------------------------------

## 31. Bulk Product Import and Update

In addition to website crawling, support spreadsheet-based
fallback/administration.

### 31.1 Excel/CSV Import

Provide downloadable template and bulk import for fields such as:

-   SKU.
-   Brand.
-   Category.
-   Product.
-   Variant.
-   Descriptions.
-   Price fields.
-   Stock fields as allowed.

### 31.2 Preview and Validation

Before commit, display:

-   Valid rows.
-   Invalid rows.
-   Missing required fields.
-   Duplicate SKU.
-   Existing products to update.
-   New products to create.

User must confirm before applying.

### 31.3 Bulk Images

Support an efficient bulk image workflow, e.g. image filenames mapped to
SKU/product identifiers.

Example:

`WHOO001-1.jpg`, `WHOO001-2.jpg`.

### 31.4 Bulk Price Update

Allow Owner/authorized manager to:

1.  Export product list.
2.  Edit prices in spreadsheet.
3.  Re-import.
4.  Preview differences.
5.  Confirm.
6.  Audit changes.

SKU acts as a stable business identifier for import matching, while the
database uses internal IDs.

------------------------------------------------------------------------

## 32. Tips

Tips belong to the specific KTV(s) who actually served the customer.

If multiple KTV served one visit:

-   Customer can tip each separately.
-   Customer is not required to tip all.
-   If the same KTV performed multiple services, avoid unnecessary
    duplicate tip rows.

Track:

-   Invoice/visit.
-   Employee.
-   Amount.
-   Timestamp.
-   Collection/payment context where relevant.

Employee can view their tip totals/details.

**Tip is displayed separately from spa-paid salary.**

------------------------------------------------------------------------

## 33. Service Tour Compensation

Tour is a configured fixed/defined share per eligible paid service.

Example:

`Service price 120,000 VND → KTV tour 15,000 VND`.

Tour configuration:

-   Service.
-   Amount/rule.
-   Effective start.
-   Effective end/version.
-   Active status.

Historical completed services retain historical tour results.

A free service from combo bonus/reward does not generate tour.

If a future paid-service correction affects tour, use explicit
adjustment rather than rewriting history.

------------------------------------------------------------------------

## 34. Payroll

Monthly payroll should support:

-   Base salary.
-   Service tour.
-   Product sales commission.
-   Bonus.
-   Positive/negative adjustments.
-   Payroll period.
-   Draft/closed/paid status as appropriate.
-   Notes.
-   Audit history.

Tip is shown separately as `Tip khách hàng`.

Conceptual presentation:

`Base salary + Tour + Product commission + Bonus ± Adjustments = Spa-paid payroll`

`Customer Tips = Separate`

Attendance data is available for reporting, but V1 must not invent
automatic salary deductions unless configured.

Closed payroll periods should be locked against ordinary destructive
editing. Corrections use authorized adjustments.

------------------------------------------------------------------------

## 35. Cash Safe / Daily Closing

### 35.1 Opening Float

Current desired opening/next-day cash float:

**1,000,000 VND**

This is Dashboard-configurable and must not be hard-coded.

### 35.2 Daily Closing

Track:

`Opening Float + Cash Receipts - Authorized Cash Expenses = Expected Cash`

Then record:

-   Actual counted cash.
-   Difference.
-   Reason/notes where required.
-   Owner/authorized withdrawal.
-   Desired next-day float.
-   Closing actor/time.

### 35.3 Cash Permissions

KTV can deposit collected cash.

KTV cannot create arbitrary cash withdrawals.

Only:

-   Owner.
-   Manager with `MANAGE_CASH`.

may create/confirm cash outflow/withdrawal.

Require amount and reason.

Audit cash actions.

------------------------------------------------------------------------

## 36. Dashboard and Reporting

### 36.1 Owner Overview

Dashboard may show:

-   Today's revenue.
-   Cash.
-   PayOS/transfer.
-   Customer count.
-   Bookings.
-   Customers currently in service.
-   Waiting queue.
-   Service revenue.
-   Product sales.
-   Combo sales/use.
-   Tips.
-   Tours.
-   Commissions.
-   Inventory alerts.
-   Leave requests.
-   Return cases.
-   Cash discrepancies.
-   Payment anomalies.
-   Payroll alerts.

### 36.2 Reporting Periods

Support:

-   Day.
-   Week.
-   Month.
-   Quarter.
-   Year.
-   Custom date range.

### 36.3 Revenue Breakdown

Report by:

-   Services.
-   Products.
-   Combos/packages.
-   Payment method.
-   Branch.
-   Employee attribution where appropriate.

### 36.4 Employee Reports

Provide metrics such as:

-   Customer count.
-   Services completed.
-   Actual work/service time.
-   Service sales.
-   Product sales.
-   Tips.
-   Rating.
-   Tour.
-   Commission.
-   Leave.
-   Check-in/out.

Do not automatically label employees as "good" or "bad"; provide factual
metrics.

### 36.5 Export

Excel and PDF export is a high-priority requirement.

Export relevant reports including:

-   Revenue.
-   Inventory.
-   Stock receipts/movements.
-   Product sales.
-   Employees.
-   Tour.
-   Commission.
-   Payroll.
-   Cash closing.
-   Other operational reports.

Exports must honor permissions and branch scope.

------------------------------------------------------------------------

## 37. Reviews

After payment, customer can submit:

-   1--5 star rating.
-   Comment.

Architecture should support KTV-related rating and visit/service
context.

Whether reviews are public on the marketing website and exact multi-KTV
review presentation may be configured/refined later. Do not
automatically publish private/internal feedback without an explicit
rule.

------------------------------------------------------------------------

## 38. Notifications

Create a Notification Center domain.

### 38.1 Customer Notifications

Examples:

-   Booking confirmed.
-   Booking changed/cancelled.
-   KTV unavailable.
-   KTV reassigned.
-   Combo/reward updates.
-   Birthday.
-   Invoice/payment.
-   Relevant loyalty events.

### 38.2 KTV Notifications

Examples:

-   New booking.
-   Customer arrival.
-   Schedule change.
-   Five-minute Start/End warning.
-   Leave result.
-   Work-related updates.

### 38.3 Manager Notifications

Examples:

-   Leave requests.
-   Booking conflicts.
-   KTV absence.
-   Product return.
-   Low stock.
-   Expiry warning.
-   Cash discrepancy.

### 38.4 Owner Notifications

Examples:

-   Financial alerts.
-   Cash closing.
-   PayOS/payment anomalies.
-   Inventory.
-   Payroll.
-   Security/system alerts.

### 38.5 Channels

Architecture should support:

-   In-app.
-   Email.
-   Zalo in future.
-   Push in future.

V1 may begin with in-app + email.

------------------------------------------------------------------------

## 39. Audit Log

Audit sensitive actions.

Recommended fields:

-   Actor user/employee.
-   Action.
-   Entity type.
-   Entity ID.
-   Branch.
-   Timestamp.
-   Before values.
-   After values.
-   Reason where required.
-   Request/session metadata where useful and privacy-appropriate.

Audit at least:

-   Role/permission changes.
-   Service/product price changes.
-   Tour changes.
-   Commission changes.
-   Payroll adjustments/closing.
-   Manual point adjustments.
-   Voucher/discount changes.
-   Product returns/refunds.
-   Inventory receipts/adjustments.
-   Cash actions.
-   Payment corrections.
-   Employee status changes.
-   Combo restoration/adjustment.

Audit log must be access-controlled.

------------------------------------------------------------------------

## 40. Immutable Operational/Financial Records

Do not hard-delete:

-   Invoices.
-   Payments.
-   Refunds.
-   Stock movements.
-   Stock receipts.
-   Sales.
-   Point ledger entries.
-   Combo usage.
-   Reward redemptions.
-   Tour records.
-   Commission records.
-   Payroll records.
-   Cash closings.
-   Audit logs.

Correct mistakes using:

-   Adjustment.
-   Reversal.
-   Void/cancel where valid.
-   Refund for allowed product-return cases.
-   Archive/inactive state for master data.

Replaceable content such as product images/banners may be
deleted/replaced according to permissions.

------------------------------------------------------------------------

## 41. Data Model --- Conceptual Entities

The implementation may refine names/normalization, but the domain should
cover at least:

### Identity / Organization

-   `User`
-   `CustomerProfile`
-   `EmployeeProfile`
-   `Role`
-   `Permission`
-   `RolePermission`
-   `UserPermission` or equivalent override model
-   `Branch`
-   `EmployeeBranchAssignment`
-   `EmployeeSkill`

### Authentication / Verification

-   `OtpChallenge`
-   `PasswordResetToken/Challenge`
-   `Session` as required by chosen auth solution

### Services / Scheduling

-   `ServiceCategory`
-   `Service`
-   `Skill`
-   `Booking`
-   `BookingService`
-   `Visit`
-   `VisitParticipant`
-   `VisitService`
-   `ServiceExecution`
-   `LeaveRequest`
-   `AttendanceRecord`

### POS / Payments

-   `Invoice`
-   `InvoiceLine`
-   `Payment`
-   `PaymentAttempt`
-   `Discount`
-   `Voucher`
-   `VoucherRedemption`

### Loyalty

-   `PointLedger`
-   `PointLot` or equivalent expiration-aware ledger
-   `Referral`
-   `RewardDefinition`
-   `RewardEntitlement`
-   `RewardRedemption`
-   `ServicePackageDefinition`
-   `CustomerServicePackage`
-   `PackageUsage`
-   `PackageAdjustment`

### Products / Inventory

-   `Brand`
-   `ProductCategory`
-   `Product`
-   `ProductVariant`
-   `ProductImage`
-   `Supplier`
-   `InventoryLot`
-   `StockReceipt`
-   `StockReceiptLine`
-   `StockMovement`
-   `StockReservation`
-   `ProductReturn`
-   `ProductReturnEvidence`
-   `ProductImportSource`
-   `ProductImportJob`
-   `ProductImportDraft`
-   `ProductImportError`

### Compensation / Finance

-   `ServiceTourRule`
-   `ServiceTourEarning`
-   `ProductCommissionRule`
-   `ProductCommissionEarning`
-   `Tip`
-   `PayrollPeriod`
-   `PayrollRecord`
-   `PayrollAdjustment`
-   `CashRegister`
-   `CashMovement`
-   `CashClosing`

### System

-   `Notification`
-   `AuditLog`
-   `AppSetting`
-   `BranchSetting`
-   `PromotionCampaign`

Avoid a single giant table for unrelated financial ledgers.

------------------------------------------------------------------------

## 42. Data Integrity Requirements

Use database constraints and transactional logic for critical
invariants.

Examples:

-   Unique normalized email.
-   Unique normalized phone.
-   Unique employee ID where appropriate.
-   Unique SKU per product variant/product namespace.
-   Positive monetary/quantity constraints where appropriate.
-   Prevent negative stock unless explicit controlled override exists.
-   Prevent double package consumption.
-   Prevent duplicate point award for same event.
-   Prevent duplicate referral reward for same referred customer's first
    eligible event.
-   Prevent duplicate PayOS webhook/payment application.
-   Prevent KTV accepting next service while current service remains
    active.
-   Enforce Owner protection.
-   Enforce branch access scope.
-   Ensure payment total reconciliation.
-   Ensure historical snapshot fields remain immutable after
    finalization except through explicit correction mechanisms.

Use database transactions for operations that touch multiple ledgers.

------------------------------------------------------------------------

## 43. Money and Time Handling

### 43.1 Money

Store VND using integer minor/base units appropriate for VND, avoiding
floating-point monetary arithmetic.

Do not use JavaScript floating point for authoritative financial
calculations.

### 43.2 Time

Store authoritative timestamps consistently, preferably UTC internally,
while displaying/operating according to branch timezone.

Initial branch timezone: Vietnam (`Asia/Ho_Chi_Minh`).

Booking calculations must use branch-local operating time.

------------------------------------------------------------------------

## 44. Security Requirements

At minimum:

-   Secure password hashing.
-   Server-side authorization.
-   CSRF/session protections appropriate to chosen framework/auth.
-   Secure cookies where applicable.
-   Input validation.
-   Output encoding/XSS protection.
-   Rate limits for OTP/login/import-sensitive endpoints.
-   File/image validation.
-   Secure secret/environment management.
-   No credentials in Git.
-   Permission-scoped exports.
-   Audit sensitive admin actions.
-   Protect customer data from unnecessary employee exposure.
-   Restrict cost/profit data.
-   Restrict financial reports.
-   Restrict audit log access.
-   Restrict bulk import/update.
-   Re-authentication/strong confirmation for highly sensitive Owner
    actions where practical.

For website importing, treat remote content as untrusted input and
sanitize imported HTML/content before rendering.

------------------------------------------------------------------------

## 45. Backup and Restore

Provide an operational backup strategy for:

-   Database.
-   Product/customer-uploaded media metadata and required object
    storage.
-   Critical configuration.

Requirements:

-   Automated backups.
-   Defined retention policy.
-   Restore procedure.
-   Periodic restore verification.
-   Production credentials/configuration documented outside source
    control.

A backup that has never been tested for restoration is not considered
sufficient.

------------------------------------------------------------------------

## 46. Recommended Technical Direction

The exact stack can be finalized at project bootstrap. A practical
web-first direction is:

-   Modern TypeScript full-stack web framework.
-   Server-rendered/admin-friendly web application.
-   Relational database suitable for production.
-   ORM with migrations.
-   Strong schema validation.
-   Component-based UI system.
-   Object storage for product images.
-   Background job/queue capability for imports, emails and heavier
    processing.
-   Provider adapters for email, payment and future messaging.
-   Excel/PDF export services.
-   Automated tests.

**Production data should use a production-grade relational database
rather than treating a local SQLite file as the long-term production
datastore.**

Do not choose architecture solely because it is easiest for a prototype
if it makes multi-branch, inventory and financial consistency difficult
later.

------------------------------------------------------------------------

## 47. Suggested Application Areas / Routes

Exact URLs are implementation details, but organize the product clearly.

### Public/Customer

-   Home.
-   Services.
-   Products.
-   Register/login.
-   OTP verification.
-   Forgot password.
-   Booking.
-   My bookings.
-   My visits/invoices.
-   My points.
-   My combos.
-   My rewards.
-   My referrals.
-   Notifications.
-   Profile.

### Employee/KTV

-   Today's schedule.
-   Queue.
-   Customer/booking lookup.
-   Visit.
-   Start/End service.
-   Add service on behalf.
-   POS/payment.
-   Tips.
-   My tour/commission.
-   Attendance.
-   Leave.
-   Notifications.

### Manager/Owner

-   Dashboard.
-   Branches.
-   Customers.
-   Employees.
-   Skills.
-   Services.
-   Bookings/queue.
-   Visits.
-   POS/invoices.
-   Payments.
-   Discounts/vouchers.
-   Combos.
-   Loyalty/referrals/rewards.
-   Products.
-   Brands/categories.
-   Product importer.
-   Inventory.
-   Stock receipts.
-   Stock count/adjustments.
-   Returns.
-   Tour.
-   Commission.
-   Payroll.
-   Cash safe/closing.
-   Reports.
-   Notifications.
-   Roles/permissions.
-   Audit log.
-   Settings.

------------------------------------------------------------------------

## 48. API / Service Boundaries

Do not make the UI directly encode business rules.

Use server/domain services for critical operations, such as:

-   Authentication/OTP.
-   Booking availability.
-   KTV assignment.
-   Visit state transitions.
-   Service Start/End.
-   Invoice calculation.
-   Discount application.
-   Payment reconciliation.
-   Point earning/expiration.
-   Referral reward.
-   Combo consumption/restoration.
-   Reward issuance/redemption.
-   Inventory reservation/movement.
-   Product return.
-   Tour calculation.
-   Commission calculation.
-   Payroll closing.
-   Cash closing.
-   Product import.

Critical operations should be idempotent where repeated requests/events
could occur.

------------------------------------------------------------------------

## 49. State Machines

Prefer explicit state transitions.

### Booking

Possible states:

`PENDING/CONFIRMED → ARRIVED → IN_SERVICE → COMPLETED`

Alternate terminal states:

`CANCELLED`, `NO_SHOW`

### Invoice

`DRAFT → PENDING_PAYMENT → PAID`

Possible allowed alternate state:

`CANCELLED`

Product return/refund records should not simply rewrite the original
paid history.

### Employee Leave

`PENDING → APPROVED | REJECTED | CANCELLED`

### Product Import

`CREATED → CRAWLING → NORMALIZING → REVIEW_REQUIRED → APPROVED → IMPORTING → COMPLETED`

Failure path:

`FAILED`

### Payroll

`DRAFT → CLOSED → PAID` where implemented.

Do not permit invalid backward transitions without explicit correction
workflow.

------------------------------------------------------------------------

## 50. Notification/Event Architecture

Where practical, publish internal domain events after successful
transactions, e.g.:

-   `BOOKING_CREATED`
-   `CUSTOMER_ARRIVED`
-   `SERVICE_STARTED`
-   `SERVICE_ENDED`
-   `INVOICE_PAID`
-   `PRODUCT_SOLD`
-   `POINTS_EARNED`
-   `PACKAGE_CONSUMED`
-   `EMPLOYEE_LEAVE_APPROVED`
-   `STOCK_LOW`
-   `PRODUCT_RETURN_APPROVED`

Use these events to decouple notifications and derived calculations from
UI code.

Avoid awarding points/commission twice if an event is retried.

------------------------------------------------------------------------

## 51. Configuration Registry

Create controlled settings rather than scattered constants.

Examples:

-   Branch opening/closing hours.
-   Maximum advance booking days.
-   Late-arrival hold: initial `20 minutes`.
-   Late-cancel alert threshold: initial `15 minutes`.
-   KTV Start/End warning: initial `5 minutes`.
-   OTP expiration/rate limits.
-   Base loyalty conversion: initial `1,000 VND = 1 point`.
-   Point expiry: initial `365 days`.
-   Birthday multiplier: initial `2× base points`.
-   Cash float target: initial `1,000,000 VND`.
-   Low-stock threshold.
-   Expiry-warning days.
-   Notification channel settings.

Sensitive configuration changes require permissions and audit logs.

------------------------------------------------------------------------

## 52. Search and Usability

Admin/POS search should be optimized for daily spa operations.

Support quick search where appropriate by:

-   Customer phone.
-   Customer email.
-   Customer name.
-   Booking code.
-   Invoice code.
-   Employee.
-   Product name.
-   SKU.

Phone search used for referral/combo workflows must avoid unnecessarily
exposing full customer data.

------------------------------------------------------------------------

## 53. Performance and Reliability

Important targets:

-   Booking availability should respond quickly under normal branch
    load.
-   POS actions must not silently lose state.
-   Payment processing must tolerate repeated provider events.
-   Inventory writes must be transactional.
-   Product imports must run as background jobs for large catalogs
    rather than blocking a web request.
-   Import failures must be resumable/reviewable where practical.
-   Reports over large periods should use appropriate
    indexes/aggregation strategies.
-   Images should be optimized for web delivery without destroying
    originals needed by the business.

------------------------------------------------------------------------

## 54. Accessibility and Responsive Design

Web app must work well on:

-   Desktop admin/POS.
-   Tablet.
-   Mobile browser.

Use accessible labels, keyboard-friendly admin controls where practical,
readable contrast and clear status indicators.

Do not rely only on color to communicate operational status.

------------------------------------------------------------------------

## 55. Testing Requirements

Each phase requires tests appropriate to risk.

High-priority automated test areas:

-   Authentication/OTP.
-   Permissions.
-   Owner protection.
-   Booking conflicts.
-   Employee skill filtering.
-   Leave conflicts.
-   Start/End state enforcement.
-   Invoice totals.
-   Split payment reconciliation.
-   Point earning and 365-day expiration.
-   Birthday 2× points.
-   Referral one-time reward.
-   Combo consumption.
-   No tour for free entitlement.
-   Tour versioning.
-   Product commission.
-   Inventory movements.
-   Stock reservation.
-   Product return reversals.
-   Cash closing.
-   Payroll locking.
-   Audit logging.
-   Product import validation.
-   Duplicate import handling.
-   Historical snapshot preservation.

Financial/ledger operations should have integration tests, not only UI
tests.

------------------------------------------------------------------------

## 56. Development Phases

Codex must **not attempt to build the entire system in one uncontrolled
pass**.

### Phase 0 --- Bootstrap and Architecture

Deliver:

-   Repository.
-   Environment template.
-   Production-oriented database choice.
-   ORM/migrations.
-   Base UI.
-   Localization foundation.
-   Branch foundation.
-   Error handling/logging.
-   Test framework.
-   CI basics if applicable.
-   Seed strategy.

### Phase 1 --- Authentication, Owner and RBAC

Deliver:

-   Customer registration.
-   Email OTP.
-   Login/logout.
-   Forgot password.
-   Owner bootstrap.
-   Employee accounts.
-   Roles/permissions.
-   Owner protection.
-   Audit foundation.

### Phase 2 --- Services, Employees and Operations

Deliver:

-   Service management.
-   Skills.
-   Employee skills.
-   Branch assignments.
-   Attendance.
-   Leave.
-   Business hours/settings.

### Phase 3 --- Booking and Visits

Deliver:

-   Booking.
-   Any-KTV assignment.
-   Availability.
-   Multiple services.
-   Queue.
-   Arrival/check-in.
-   Walk-in/guest.
-   Start/End.
-   Five-minute warnings.
-   KTV reassignment.

### Phase 4 --- POS, Invoice and Payments

Deliver:

-   Visit invoice.
-   Service/product line architecture.
-   Staff-added service.
-   Discounts.
-   Cash.
-   Split payments.
-   Payment states.
-   PayOS adapter/interface and integration when credentials/current
    documentation are available.
-   Digital invoice history.

### Phase 5 --- Loyalty and Combos

Deliver:

-   Points ledger.
-   365-day expiration.
-   Birthday bonus.
-   Referral.
-   Reward catalog.
-   Reward entitlements.
-   Combo definitions.
-   Combo ownership/family usage.
-   Adjustments.

### Phase 6 --- Products and Inventory

Deliver:

-   Brands/categories/products/variants.
-   Pricing.
-   Promotions.
-   Product POS sales.
-   Employee seller attribution.
-   Inventory receipts.
-   Stock movements.
-   Stock count.
-   Lot/expiry.
-   Low-stock alerts.
-   Returns.

### Phase 7 --- Compensation and Cash

Deliver:

-   Tour rules/earnings.
-   Product commission.
-   Tips.
-   Payroll.
-   Cash safe.
-   Daily closing.

### Phase 8 --- Reports and Administration

Deliver:

-   Owner dashboard.
-   Manager dashboards.
-   Revenue reports.
-   Employee reports.
-   Inventory reports.
-   Payroll reports.
-   Excel/PDF export.
-   Notification center.
-   Audit-log UI.

### Phase 9 --- Product Importer

Deliver:

-   Import source configuration.
-   Authorized source adapter.
-   Crawl/extract.
-   Image download/storage.
-   Draft staging.
-   Validation.
-   Duplicate detection.
-   Preview/approval.
-   Import history.
-   Re-import/sync preview.
-   Excel/CSV fallback.
-   Bulk image import.
-   Bulk update/export.

### Phase 10 --- Hardening and Launch

Deliver:

-   End-to-end tests.
-   Permission review.
-   Security review.
-   Backup/restore test.
-   Performance review.
-   Production deployment.
-   Monitoring.
-   Operational documentation.
-   Owner acceptance testing.

------------------------------------------------------------------------

## 57. Definition of Done --- Every Phase

A phase is not complete merely because screens exist.

Before moving to the next phase:

1.  Requirements for that phase are implemented.
2.  Database migrations are valid.
3.  Authorization is enforced server-side.
4.  Validation/error states are handled.
5.  Automated tests for critical rules pass.
6.  Existing tests still pass.
7.  No known critical/high-severity bug remains.
8.  Audit requirements are implemented where applicable.
9.  Seed/demo data works where useful.
10. Relevant documentation is updated.
11. Build/lint/type-check pass.
12. Owner can manually verify the primary workflow.

Codex must report:

-   What was implemented.
-   Files/modules materially changed.
-   Migrations created.
-   Tests run/results.
-   Known limitations/TBD items.
-   Recommended next phase.

Then stop and wait for instruction before beginning the next major
phase.

------------------------------------------------------------------------

## 58. Coding-Agent Operating Rules

When this PRD is provided to Codex or another coding agent:

1.  Read this PRD completely before implementation.
2.  Inspect the existing repository before modifying it.
3.  Do not rewrite working architecture without a concrete reason.
4.  Work only on the requested phase/task.
5.  Do not silently implement Future/TBD policies.
6.  Ask for missing external credentials/assets only when that phase
    actually needs them.
7.  Keep business logic out of presentation components.
8.  Prefer migrations and backward-compatible schema evolution.
9.  Never expose secrets.
10. Never bypass authorization for convenience.
11. Never hard-delete protected financial/operational records.
12. Never hard-code The Whoo as the only brand.
13. Never hard-code the initial branch as the only possible branch.
14. Never let crawler data overwrite Lucy Spa pricing/stock/commission
    automatically.
15. Never let KTV set arbitrary service/product prices.
16. Never award tour for a free service entitlement under the current
    rule.
17. Never retroactively recalculate finalized historical
    invoices/tours/commissions because a configuration changed.
18. Use transactions/idempotency for critical multi-record operations.
19. Add tests for every critical business rule changed.
20. Stop at phase boundaries and summarize results.

------------------------------------------------------------------------

## 59. External Inputs Required Later

The project can begin without all of these, but relevant phases will
eventually need:

-   Final Lucy Spa logo.
-   Final brand assets.
-   Official service menu/data.
-   Service internal duration settings.
-   Initial employee roster.
-   Employee skills.
-   Base salaries.
-   Tour rates.
-   Product commission rules.
-   The Whoo product catalog/source website.
-   Confirmation/authorization details needed for importer
    implementation if technically relevant.
-   Product images/content source.
-   Product cost/list/promotional prices.
-   Initial stock.
-   Suppliers.
-   Reward catalog thresholds/items.
-   Campaign rules.
-   PayOS account/credentials.
-   Transaction bank configuration.
-   Email provider/domain.
-   Zalo configuration when implemented.
-   Hosting/domain.
-   Object storage provider.
-   Additional branch information when expansion occurs.

Missing future inputs must not be replaced by invented production
values.

------------------------------------------------------------------------

## 60. Current Frozen Business Rules

Unless Owner explicitly changes them, the following are the current
requirement baseline:

  -----------------------------------------------------------------------
  Rule                                Current Value
  ----------------------------------- -----------------------------------
  Business hours                      09:00--21:00

  Lunch break                         None

  Booking hold for late arrival       20 minutes

  Late cancellation manager alert     \<15 minutes before booking

  KTV Start/End warning               5 minutes

  KTV may accept next customer before No
  current End                         

  KTV may enter arbitrary service     No
  price                               

  Price authority                     Owner / authorized high-level
                                      manager

  Combo expiry                        No expiry

  Service/combo refund                No

  Base loyalty                        1 point / 1,000 VND eligible spend

  Point expiry                        365 days per earned lot

  Birthday points                     +100% bonus = 2× base points

  Birthday period                     Exact birthday date only

  Referral identifier                 Customer phone number

  Referrer relationship               Permanent

  Referral earning                    First eligible paid transaction per
                                      referred customer

  Cosmetics earn base points          Yes

  Tip earns points                    No

  Points transferable                 No

  Points usable as partial cash       No
  payment                             

  Free combo/reward service earns KTV No
  tour                                

  Product prices imported from source No
  site automatically                  

  Product importer writes directly to No
  live catalog without review         

  Initial cash float target           1,000,000 VND, configurable

  KTV cash withdrawal permission      No

  Multi-branch architecture           Yes, from V1

  Online product shipping             Future/TBD

  Zalo                                Future/integration phase

  Physical payment speaker            Future/integration-specific
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 61. Explicit TBD / Do Not Guess

The following are intentionally unresolved and must not be invented:

-   Online shipping fee.
-   Shipping provider.
-   COD policy.
-   Free-shipping threshold.
-   Failed-delivery policy.
-   Detailed online fulfillment workflow.
-   Exact PayOS credentials/account.
-   Exact payment-speaker hardware integration.
-   Zalo implementation.
-   Final reward catalog.
-   Final tour amounts.
-   Final salaries.
-   Final product commissions.
-   Final product prices.
-   Final product stock.
-   Exact cosmetic campaign thresholds/stacking until configured.
-   Exact referral eligible transaction categories/reward formula until
    configured.
-   Public-vs-internal review publishing policy.
-   Automatic attendance-based payroll deductions.
-   Tax/e-invoice integration.
-   Final hosting/storage providers.

------------------------------------------------------------------------

## 62. Launch Acceptance Scenarios

Before V1 production launch, the system should successfully demonstrate
at least these end-to-end scenarios:

### Scenario A --- New Member Booking

Customer registers → email OTP verifies → books multiple services →
selects qualified KTV → receives confirmation → arrives → staff marks
arrived → KTV Starts/Ends → invoice created → customer pays → points
awarded → invoice visible.

### Scenario B --- Busy KTV

Customer selects busy KTV → system shows unavailable/busy state and
suitable estimated availability → customer selects suggested time or
another qualified KTV.

### Scenario C --- Forgotten End

KTV starts service → expected End passes by 5 minutes without End → KTV
and manager receive warning → KTV remains unavailable → next customer
cannot be assigned until End/authorized resolution.

### Scenario D --- Family Combo Use

Member owns non-expiring service combo → relative provides owner's phone
→ staff finds correct owner → records relative use → consumes one
correct service session → no tour generated for free bonus entitlement →
history remains auditable.

### Scenario E --- Product Sale

KTV sells product → system uses configured price → KTV cannot change
price → stock decreases → base points awarded after payment → seller
commission recorded → invoice snapshots values.

### Scenario F --- Birthday

Eligible customer pays 500,000 VND on exact birthday → receives 500 base
points + 500 birthday bonus → point lots carry 365-day expiration.

### Scenario G --- Referral Chain

A permanently refers B → B completes first eligible paid transaction → A
receives configured one-time referral reward → B later refers C → B can
receive C's first-transaction referral reward.

### Scenario H --- Inventory Count Difference

System stock 20 → physical count 19 → authorized manager records -1
adjustment with reason → audit log created → no silent stock overwrite.

### Scenario I --- Product Return

Eligible cosmetic return approved → return/refund recorded → applicable
points/rewards/commission reversed → stock restored only if sellable →
original financial history retained.

### Scenario J --- Product Import

Owner starts authorized source import → products/content/images
extracted → staged as drafts → duplicates/errors displayed → Owner
approves selected records → local catalog created without adopting
source price → products remain non-sellable until required Lucy Spa
pricing is configured.

### Scenario K --- Multi-Branch Permission

Manager assigned to Branch A cannot access protected Branch B
operational/financial data unless explicitly granted broader scope;
Owner can access both.

### Scenario L --- Daily Cash Closing

Opening float loaded → cash sales recorded → authorized cash movement
recorded → system calculates expected cash → actual cash counted →
discrepancy shown → authorized withdrawal leaves configured next-day
float → closing locked/audited.

------------------------------------------------------------------------

## 63. Final Product Direction

Lucy Spa V1 should be built as a reliable operating foundation rather
than a collection of disconnected screens.

The core architecture must preserve the following long-term
capabilities:

`Customer → Booking → Visit → Service/Product → Invoice → Payment`

`Employee → Skill → Service Execution → Tour/Commission/Tip → Payroll`

`Product → Inventory → Sale → Return`

`Customer → Points/Referral/Combo/Reward`

`Branch → Employees/Bookings/Inventory/Cash/Reports`

`Authorized Product Source → Import Draft → Review → Catalog`

All financial, inventory, loyalty and compensation effects must be
traceable to the event that created them.

The system should be straightforward for Lucy Spa staff to operate while
giving Owner strong control, visibility, historical accuracy and room to
expand.

------------------------------------------------------------------------

**END OF LUCY SPA PRD --- REQUIREMENT FREEZE V1**
