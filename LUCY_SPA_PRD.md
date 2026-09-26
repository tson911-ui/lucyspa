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
-   Independent Lucy Spa and Lucy Beauty loyalty points and membership tiers.
-   Configurable Birthday Rewards / Birthday Vouchers.
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

### 4.4 Premium Motion Design (FUTURE / NOT CURRENT PHASE)

**Status: future requirement. Not authorized for implementation in the
current phase, and not part of Phase 2.**

The public/customer-facing Lucy Spa website must not end up visually
static or look like a generic CRUD application. When the customer-facing
UI is implemented, it should use one cohesive, premium motion design
system appropriate for a luxury spa and beauty brand (section 4.1).

Possible techniques, used only where they genuinely improve the
experience (not a requirement to use every effect):

-   Smooth content reveals.
-   Subtle scroll-driven animation.
-   Light parallax.
-   Page transitions.
-   Image/product hover interactions.
-   Micro-interactions.
-   Sticky storytelling or other modern interactions.

Rules:

-   Motion is cohesive across the whole site, defined once as part of the
    design system, not arbitrary per-page effects.
-   Premium and elegant, never distracting.
-   Responsive.
-   Performance-conscious: must not materially damage Core Web Vitals or
    SEO.
-   Reduce or avoid expensive effects on weaker/mobile devices where
    appropriate.
-   Respect `prefers-reduced-motion` and accessibility (section 54).
-   Internal workforce/admin dashboards prioritize speed and usability and
    must **not** receive unnecessary cinematic animation.

Implementation timing: implement the premium motion system when the
**customer-facing** website UI/design system is being built and its main
layout and design language are stable. The Phase 2 workforce login and
dashboard is **not** the target for this motion system. The current
roadmap (section 56) does not assign a numbered phase to the
customer-facing website UI, so this is recorded as a future
implementation milestone rather than a numbered phase.

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
-   Enforce a reasonable password policy: 8–128 characters for every
    account, customer and workforce alike (Owner decision 2026-09-26), with
    known common passwords rejected when a password is set or reset.

### 6.4 Forgot Password

**Customers** use the self-service verification/reset flow:

`Request reset → email OTP/token verification → set new password`

Never email a default or existing password.

**Internal workforce** (approved Owner decision, Employee management): the
Owner or an authorized manager sets or resets a workforce member's password
directly, without any employee OTP (see 7.1a). The existing workforce email
reset may remain available for workforce members with a verified recovery
email, but it is not the required path.

### 6.5 Updating Email or Phone

Sensitive identity changes require verification. OTP verification must
be used as appropriate before completing changes.

### 6.6 Customer Account Area

Customer can view relevant:

-   Profile.
-   Booking history.
-   Service history.
-   Payment/invoice history.
-   Separate Lucy Spa and Lucy Beauty point balances/history and current tiers.
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

### 7.1a Workforce Accounts and Credentials (approved)

Customers and internal workforce have separate account flows. Customer
self-registration, OTP verification and customer password recovery are
unchanged.

Internal workforce (trainees, official employees, KTVs, managers and future
roles) does not self-register and needs no OTP for account provisioning:

-   The employee ID (employee code, for example `NV0001`) is the workforce
    login ID. There is no separate username. The code is only an
    identifier: it carries no classification or role meaning.
-   When creating a workforce member, an authorized creator may set up login
    access immediately by setting an initial password; the account is then
    active at once. Without it the account waits for access to be set up.
-   The Owner or an authorized manager may set or reset a workforce member's
    password directly (no employee OTP).
-   These actions need the employee-access permission in every branch of the
    employee, a recent confirmation of the acting user's own password, and
    never let a manager take over a more powerful account, their own
    account or the Owner's account.
-   Passwords follow the global policy for every Lucy Spa account (8–128
    characters since the Owner decision of 2026-09-26; common passwords
    rejected), are stored only as secure hashes, and never appear in logs,
    audit records or responses. Setting a password signs the employee out of
    every existing session.
-   Employment classification (Trainee, Collaborator/CTV, Official employee,
    Ended) is separate from account status and from roles. A trainee may have
    an active account. "Manager" is a role, not a classification: a manager is
    an official employee holding a manager-group role, with official-employee
    compensation.
-   Ending employment records the Ended classification with its date and, when
    requested and the date is today or earlier, disables sign-in in the same
    action. Nothing is deleted. A future end date is recorded but does not
    disable access automatically (there is no scheduler); access must then be
    disabled on or after that date. Ended employment cannot be re-enabled or
    given new credentials (no rehire).

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
-   Lucy Spa point eligibility for eligible paid service amounts.
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
9.  For a collaborator (CTV): a scheduled CTV work occurrence at that branch
    covering the whole service time (see 9.1).

Suggested operational statuses:

-   `AVAILABLE`
-   `BOOKED`
-   `IN_SERVICE`
-   `BREAK`
-   `ON_LEAVE`
-   `OFFLINE`

Prefer deriving status automatically from operational events rather than
relying only on manual status toggles.

### 9.1 Collaborator (CTV) Work Schedule and Agreed Pay

A collaborator (CTV) has no fixed schedule and no base salary. Owner or an
authorized manager calls a CTV in for a specific work occurrence at one
branch on one branch-local work date.

-   Each occurrence has exactly one mode:
    -   `Theo ca` / SHIFT: explicit start and end times, which must lie
        entirely inside the branch opening hours for that date. A shift
        outside the opening hours is blocked, not merely warned.
    -   `Full ngày` / FULL_DAY: takes the branch opening hours of that date
        as a snapshot when it is scheduled. Later changes to branch hours
        never rewrite an agreed occurrence. A closed day cannot be
        scheduled.
-   The same CTV cannot have overlapping scheduled occurrences, at any
    branch.
-   Only a person who is a CTV on the work date, with an assignment at the
    branch, can be scheduled.
-   `Tiền công thỏa thuận` / agreed pay is entered manually per occurrence.
    It is never calculated from hours or an hourly rate. Attendance (late,
    early, missing check-out) never changes it. Corrections are explicit,
    authorized and audited.
-   Scheduling and pay are separate authorities: the scheduling permission
    does not grant entering or viewing pay.
-   A CTV sees their own schedule and their own agreed pay.
-   Occurrences are never deleted. Cancellation keeps the record with a
    reason. Past-dated changes are allowed for authorized management with a
    reason.
-   When a person stops being a CTV (ended or promoted), their future
    occurrences are cancelled; historical ones are kept.
-   A CTV does not use Leave. No scheduled occurrence means not scheduled to
    work.
-   Agreed CTV pay is a personnel/operating cost of the branch where the
    occurrence happened. It is not depreciation. The occurrence is its single
    source: payroll, finance and personal income views reference it and never
    copy the amount.

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

Collaborators (CTV) do not use leave; their availability comes from their
scheduled work occurrences (see 9.1).

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
-   Applicable pre-transaction Spa/Beauty membership tier and selected benefit,
    visible to staff so they can explain the choice to the customer.
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
-   Applicable Spa/Beauty wallet, valid pre-transaction balance and tier.
-   Applied tier threshold/discount rule and result, selected ordinary promotion,
    and any configured Birthday Reward/Voucher and stacking/calculation result.
-   Eligible amount actually paid attributed to each wallet and related point
    awards/adjustments, with references needed to reconstruct their origin.

Future configuration changes must not retroactively alter historical
records.

In particular, later changes to tier thresholds, discount percentages,
promotion configuration or Birthday Reward configuration must not rewrite
completed financial or loyalty facts. Preserve the applied rule/version and
result as appropriate; corrections use linked adjustments, not recalculation
of finalized history.

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

### 16.1 Ordinary Promotions and Member Discounts

Ordinary eligible promotions and Member Discounts **do not stack**. When
more than one ordinary eligible discount is available, automatically apply
the financially better eligible benefit for the customer, considering its
applicable scope and conditions. Staff must see which benefit was selected
so they can explain and advise the customer. Do not charge the customer a
less favorable eligible discount merely because staff did not select one.

Use the appropriate Lucy Spa or Lucy Beauty tier from the customer's valid
balance **before** the transaction earns points (section 18). Member
Discounts do not consume points. Do not add service-specific Member
Discount caps/exclusions or Beauty monetary caps that contradict this
shared tier model; honor the configured eligibility of the transaction.

Example: Diamond provides 7%, while an eligible sale provides 15%.
On 500,000 VND, apply the 15% sale only: `500,000 → 425,000 VND paid`.
The corresponding wallet earns 425 points after successful payment.
Not using the Member Discount does not itself change the customer's tier.
If the eligible sale is 5% and the Member Discount is 7%, select the 7%
Member Discount instead.

Birthday Rewards are handled separately under section 19. They are not
automatically ordinary promotions, nor automatically stackable with every
promotion. Ambiguous mixed-invoice allocation or valuation of unlike
benefits must not be invented to choose a discount.

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
-   Eligible purchase configuration, subject to the fixed earning-once rule
    in section 17.7; usage cannot earn the purchase points again.
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

### 17.7 Combo Purchase: Member Discount and Points

Customers may receive their applicable **Lucy Spa Member Discount** on an
eligible combo purchase, including combos with included promotional
sessions such as buy 10/get 2 or buy 5/get 1. Included bonus sessions do not
disqualify the purchase from that Member Discount. Any competing ordinary
eligible discount follows section 16.1; it does not stack with the Member
Discount.

Use the Lucy Spa tier determined before this purchase earns new points.
Award Spa points **once**, after the combo purchase is successfully paid,
from the eligible amount actually paid after discounts/vouchers.

Example: eligible combo price 1,000,000 VND, Diamond 7% Member Discount,
930,000 VND actually paid → **930 Lucy Spa points**.

Later consumption of any prepaid combo session earns **0 new points**.
Included free/gift sessions also earn no additional points. Preserve the
existing no-expiry, family-use, adjustment and no-tour-on-free-session rules.

### 17.8 Extra Services During a Combo Visit

An additional service purchased outside the prepaid combo is a new eligible
paid service. Apply the applicable Lucy Spa Member/Promotion rules and
award Spa points from the eligible amount actually paid for that extra
service. The consumed prepaid combo session still earns no new points.

Example: a customer uses one prepaid session and adds an eligible
200,000 VND service. Combo usage earns 0 points; the extra service follows
normal discount, successful payment and point-earning rules.

------------------------------------------------------------------------

## 18. Loyalty Points and Membership

Each customer has two independent balances:

-   **Lucy Spa Points:** eligible Lucy Spa services and Spa-side activity.
-   **Lucy Beauty Points:** eligible Lucy Beauty product/cosmetic purchases
    and Beauty-side activity.

The balances cannot be merged or transferred between Spa and Beauty.
Each balance independently determines its membership tier. A customer may
be Diamond in Lucy Spa and Gold in Lucy Beauty at the same time. The two
wallets are business distinctions, not a substitute for branch scope.

### 18.1 Base Earning Rule

Current rule:

**1,000 VND of eligible amount actually paid = 1 point.**

Use **whole points only**. Award purchase points only after successful
`PAID` payment, based on the eligible amount actually paid after applicable
discounts/vouchers. **Tips earn no points.**

Attribute eligible Spa service/combo amounts to Lucy Spa Points and
eligible Beauty product/cosmetic amounts to Lucy Beauty Points. Other
explicitly authorized activity awards must identify their wallet; the
fixed referral award in section 20 credits both independently.

Do not award points twice for the same paid amount, including payment
retries, split-payment processing, replacement of already-paid products
or consumption of prepaid combo sessions. Additional eligible exchange
amounts follow section 28.5.

For mixed invoices, preserve attribution to the corresponding eligible
portions. Do not invent allocation of shared discounts/vouchers or
payments between Spa and Beauty where no rule is established. Fractional
remainders and rounding/aggregation boundaries not specified here require
an explicit rule before implementation; no fractional points or assumed
carry-forward policy may be introduced.

### 18.2 Points Are Not Currency

Points:

-   Cannot directly reduce invoice amount.
-   Cannot be combined with money as partial payment.
-   Cannot be transferred between customer accounts.
-   Cannot be transferred between Spa and Beauty or merged.
-   Cannot be converted into cash.

**Member Discounts do not spend or deduct points.** There is no normal
workflow for selecting and redeeming a point milestone for a Member
Discount, and no one-milestone-per-transaction rule. Points continue
accumulating; a valid refund/correction can change the balance as described
below. A membership benefit is a tier entitlement, not point currency.

### 18.3 Point Expiry

**Lucy Spa Points and Lucy Beauty Points never expire.**

Valid earned points remain indefinitely. Member benefit usage does not
reduce them. Only applicable authorized adjustments/refunds/reversals
change awarded balances; the referral retention exception in section 20.4
must also be respected.

There is **no automatic expiration, annual reset or rolling expiry** in
either wallet. Keep complete historical point ledger records permanently.
Voucher/reward validity periods and inventory expiry are separate concepts.

### 18.4 Manual Adjustments

Only Owner or sufficiently authorized manager may add/subtract points
manually.

Require:

-   Amount.
-   Wallet (Lucy Spa or Lucy Beauty).
-   Reason.
-   Actor.
-   Timestamp.
-   Audit log.

Use compensating ledger entries, never overwrite the balance or delete,
mutate or rewrite the original point event. Preserve the original
transaction/event, linked adjustment, reason, authorized actor, timestamp
and reference to the original event where appropriate. Prevent duplicate
correction/refund adjustments for the same effect.

Example: staff mistakenly confirms payment and `+500` points are awarded.
An authorized manager corrects it through a linked `-500` adjustment.
Both entries remain auditable. A cancelled/incorrect transaction does not
erase its history or create an ordinary service/combo refund workflow.

Recalculate the current valid balance and tier in the affected wallet
after an adjustment. A threshold crossing can decrease that tier. Keep the
other wallet independent and do not claw back a referrer's protected
introduction award because the referred transaction was later reversed.

### 18.5 Membership Tiers

Use the **same locked table independently for Lucy Spa and Lucy Beauty**:

| Current valid points in the corresponding wallet | Membership tier | Member Discount |
| --- | --- | --- |
| 0–499 | No membership tier discount | 0% |
| 500–999 | Silver | 3% |
| 1,000–2,999 | Gold | 4% |
| 3,000–4,999 | Platinum | 5% |
| 5,000–9,999 | Diamond | 7% |
| 10,000+ | Ruby | 9% |

Use the spelling **Diamond**. These are membership tiers derived from the
current valid point balance, not point-spending/redemption milestones.
Member Discounts use the corresponding wallet's tier and do not deduct
points. Refund/correction-driven tier decreases are allowed. Do not
invent treatment of an adjustment that would make a balance negative.

### 18.6 Tier and Point Timing for a Transaction

1.  Read the customer's valid balance in the corresponding wallet before
    the transaction earns points.
2.  Determine that wallet's membership tier.
3.  Determine the applicable eligible discount/promotion, following
    sections 16 and 19.
4.  Calculate the final eligible amount actually paid.
5.  Complete payment successfully.
6.  Award the transaction's points to the corresponding wallet once.
7.  Recalculate balance/tier for future transactions.

Crossing a threshold during this transaction does **not** retroactively
change its discount. A transaction that does not use the Member Discount
does not by that fact reduce the customer's tier.

Example: 980 Lucy Spa points → Silver 3%. An eligible 100,000 VND service
becomes 97,000 VND after the Member Discount. Successful payment earns
97 Spa points. The new balance is 1,077 (Gold); Gold 4% applies from the
next eligible transaction, not this completed one.

Snapshot the applied balance/tier, benefit rules/results and eligible
paid amounts so later configuration or balance changes cannot rewrite
the transaction (section 14.2).

------------------------------------------------------------------------

## 19. Birthday Rewards

Birthday does **not** automatically multiply loyalty points. Use
Owner-configurable **Birthday Rewards / Birthday Vouchers** instead.

A configured benefit may be a fixed monetary discount, percentage
discount, free service, gift or another supported configurable benefit.
Owner controls its actual type, value, eligibility, Spa/Beauty scope,
validity/conditions and permitted combinations. Do not invent a fixed
reward, birthday eligibility period or usage limit when not configured.

A Birthday Reward may be configured to combine with a Member benefit.
It does not automatically stack with every Member benefit or ordinary
promotion: follow the configured eligibility and stacking rules. A missing
combination rule must not be inferred as permission to stack.

When a configured fixed monetary Birthday Voucher is allowed to combine
with a Member Discount, use this order:

`Original eligible amount → Member Discount → Birthday Voucher → final eligible amount actually paid → points`

Example only: original eligible amount 500,000 VND; Diamond 7% gives
465,000 VND; an explicitly configured, combinable 50,000 VND Birthday
Voucher leaves 415,000 VND actually paid and earns 415 points in the
corresponding wallet. **50,000 VND is an example, not a global default or
fixed birthday benefit.** The award follows normal earning from the final
eligible amount; free/gift benefits do not create an additional paid amount.

Preserve the applied Birthday Reward configuration/result with the
historical transaction. Other reward/voucher types follow their configured
rules, not an assumed fixed-voucher calculation.

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

Let **A** be the referrer and **B** the referred customer. Award A only
after all of these conditions are satisfied:

-   B is genuinely a **new customer**, coming to Lucy Spa for the first time.
-   B successfully registers.
-   B completes their first qualifying service/customer visit.
-   Payment for that first qualifying transaction completes successfully.

A then receives the fixed reward **+10 Lucy Spa points AND +10 Lucy Beauty
points**, once for that referred customer B. These are two independent
credits, not a transfer or conversion between wallets.

The size/value of B's invoice or points earned does not increase A's award.
Whether B pays 100,000 VND, 500,000 VND or 5,000,000 VND for that qualifying
first visit, A receives only +10 Spa and +10 Beauty points. Product purchase
alone does not replace the first qualifying completed Spa visit condition.
B's second and later visits/transactions never generate additional referral
points for A. Enforce the genuinely-new and one-time conditions; do not
invent additional referral limits.

The existing phone identifier, permanent referrer relationship and referral
chain behavior remain. Each link must independently satisfy the same new
customer/first-visit/registration/payment conditions.

### 20.4 Referral Reward Retention

If B's qualifying transaction is later refunded or reversed, **do not claw
back A's already-earned +10 Spa and +10 Beauty introduction award**. It
rewards successful new-customer introduction and remains with A.

Keep this award distinguishable from purchase points attributable to B's
payment, which follow applicable refund/correction rules. This retention
exception does not permit ordinary service/combo refunds (section 29).

------------------------------------------------------------------------

## 21. Reward Catalog and Entitlements

Keep these domains separate:

-   Lucy Spa Points and Lucy Beauty Points (independent balances/tiers).
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

Reward/voucher redemption means use of the configured entitlement; it is
separate from membership benefits and does not itself authorize deducting
loyalty points. Member Discounts never require point redemption. A reward's
configured expiry does not cause either point balance to expire. Do not
invent a point-priced reward program from the existence of this catalog.

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
-   Bonus points and the corresponding wallet where explicitly configured.
-   Reward entitlement.
-   Usage limit.
-   Customer usage limit.
-   Active status.
-   Benefit eligibility/selection and combination rules consistent with
    sections 16.1 and 19.

Ordinary promotional discounts compete with the corresponding Member
Discount: automatically select the financially better eligible discount
and do not stack them. Configured bonus/gift benefits must not silently
override that rule. Birthday combinations follow section 19 separately.

For campaign details still unresolved, including whether displayed points
are "bonus" versus "total", gift/bonus combinations or valuation of unlike
benefits, require an explicit rule rather than infer one. The ordinary
discount-versus-Member selection rule is already locked, not a TBD.

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

### 24.1 Promotion / Campaign Management (FUTURE / NOT CURRENT PHASE)

**Status: future requirement. Not authorized for implementation in the
current phase, and not part of Phase 2.** It extends this section's product
promotions and belongs to the existing Phase 6 --- Products and Inventory
("Promotions", section 56). No new phase is created for it.

Goal: Lucy Beauty may eventually have hundreds or thousands of products.
The Owner must be able to run promotions such as 10/10, 11/11, Black
Friday, Christmas, New Year, Tết, monthly and custom campaigns **without
editing each product's base selling price**. The Owner decides which
products participate, how much they are discounted, when the promotion
starts and ends, and where/how it is presented to customers.

**Campaign concept.** A future Promotion/Campaign has fields/behavior
equivalent to: name; optional internal description; start date/time; end
date/time; status (Draft / Scheduled / Active / Ended or Expired); selected
products; discount rule; and promotional presentation configuration.
Exact schema and enum names belong to implementation.

-   Campaigns can be scheduled in advance. They apply automatically at the
    configured start and stop applying automatically at the configured end.
-   The Owner never has to restore each product's normal price after a
    campaign ends.
-   Time handling follows the project's branch/business timezone principles
    (section 43.2). For example, "11/11 Sale" runs 11/11 00:00 to 23:59
    local time. The scheduler/job implementation belongs to the future
    design.

**Bulk product selection.** Filter and search by brand,
category/subcategory, SKU/model, product name, price range,
inventory/availability where applicable, and other useful attributes.
Support individual selection, multi-select, and select-all from a filtered
result where safe. For example, filtering Brand = The Whoo and Category =
Skincare gives 42 products; **Select All → add to campaign** avoids
editing 42 products one by one.

**Discount configuration.** At least percentage off (for example 10% or
20%), fixed amount off (for example 100,000 VND) and an explicit
promotional price where appropriate (for example 899,000 VND). These are
examples, not a hard-coded list, if the pricing architecture needs a more
general rule representation.

-   The base/catalog selling price and the temporary promotional price stay
    conceptually separate.
-   A promotion never destroys or rewrites the historical/base price to
    create a temporary sale.
-   One campaign may apply one rule to a selected group or, where the
    implementation supports it, different rules to different groups (for
    example Black Friday: Group A 10%, Group B 20%, Group C a promotional
    price). The final schema is a future design decision.

**Conflicts and stacking.** A product may accidentally belong to
overlapping campaigns (for example Black Friday 20% and Weekend Sale 10%).
The engine must **never** add them into a 30% discount. It must:

-   Detect overlapping applicable promotions.
-   Prevent accidental double discounting.
-   Show conflicts during campaign configuration and review.
-   Apply only the promotion allowed by the business rule.

Ordinary promotions follow section 16.1: they do not stack with each
other or with the corresponding Member Discount, and the financially better
eligible benefit applies unless an explicit configured rule says otherwise.
No more complex priority algorithm is defined here.

**Customer-facing presentation surfaces.** A campaign can drive
customer-facing presentation without code changes for each sale event:
homepage hero/banner, promotional popup (section 4.2), product-card sale
badge, product-detail sale presentation, sale collection/page, and
promotional section/block. For example: "BLACK FRIDAY · Up to 30% off ·
[Shop Sale]". The Owner associates these elements with a campaign instead
of asking a developer to edit the website for every event.

**Popup/banner management.** Authorized users can configure title, short
message, campaign image/banner, CTA label, CTA destination, active time
range and campaign association, with a preview (at least desktop and
mobile) before activation where practical. This is manageable campaign
presentation only; no page builder or CMS is designed here.

**Product display during a promotion.** Where applicable, show the
normal/base price, the promotional price, the discount amount/percentage,
a sale badge and the campaign association (for example
`1,000,000 VND → 900,000 VND, -10%`). Visual styling is not hard-coded
here. The premium motion system (section 4.4) may enhance campaign
presentation, but promotion business logic stays independent of visual
animation.

**Review, preview and approval.** Before scheduling/publishing, the
Owner/authorized user reviews the selected products, proposed discounts,
resulting promotional prices, start/end time, conflicts/overlaps and the
banner/popup configuration, to catch mistakes before the campaign becomes
active. Sensitive commercial changes remain subject to the appropriate
authorization.

**Operating goal.**

`Create Campaign → Choose dates → Find/filter products → Select in bulk → Set discount → Configure optional banner/popup/sale presentation → Preview → Schedule/Publish`

Then the **system** activates at the start time, shows promotional
pricing/presentation, stops at the end time, and restores normal effective
catalog pricing automatically. The Owner never has to change hundreds of
prices by hand, restore them after the campaign, or ask a developer to
create a popup/banner for an ordinary promotion.

**Relationship to other components (kept separate):**

-   **Supplier Catalog Importer (section 30.9):** discovers and synchronizes
    supplier/source product information, and prepares Lucy Beauty catalog
    candidates and proposed source changes.
-   **Lucy Beauty Product Catalog:** the operational product source of
    truth.
-   **Promotion/Campaign Engine:** applies Lucy Beauty's temporary
    commercial promotion rules to selected catalog products.
-   **Customer website:** presents the resulting campaign, sale pricing,
    badges, banners, popups and sale pages.

A supplier price change never automatically becomes a Lucy Beauty
promotion, and a Lucy Beauty promotion never modifies supplier
observations.

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

### 28.4 Return Accounting and History

Record whether the Lucy Beauty case is a **product-fault exchange** or a
**refund**; their point effects differ under sections 28.5 and 28.6. Preserve
the seal/packaging, 48-hour, photo/evidence and shipping-cost policies above.
The product-fault customer-care exception does not automatically extend to
unrelated voluntary returns or grant a new refund eligibility window.

Reverse/adjust money, product commission and configured reward entitlements
as applicable under their existing policies; record stock effects. Return
stock to sellable inventory only if the item is actually eligible. Do not
infer an exchange refund/payment policy merely from the point examples below.

Keep original purchases, point awards, exchanges, refunds and their linked
adjustments auditable. Do not delete or rewrite finalized history. Campaign
point adjustments must be attributable to the refunded amount under the
configured rule; the protected referral award to A is never clawed back
because B's qualifying transaction was refunded/reversed (section 20.4).

### 28.5 Product-Fault Exchange: Lucy Beauty Points

For an eligible exchange resolving a product fault/problem:

-   **Higher relevant replacement value:** retain the original purchase
    points and award additional Beauty points only on the eligible
    additional paid/value difference, at the normal earning rate.
-   **Same relevant value:** retain the original points; award no duplicate
    points for the replacement.
-   **Lower relevant value:** retain the original points. Do not deduct
    them merely because the replacement is cheaper; this is customer-care
    handling of the product incident.

Examples: an eligible original 500,000 VND purchase earns 500 Beauty
points. A 600,000 VND replacement earns an additional 100 Beauty points
where the eligible additional amount is 100,000 VND. A same-value
replacement earns no additional points. A 400,000 VND replacement retains
the original 500 points. Do not award again on the original paid portion
or assume list-price difference is always an eligible additional amount.

These rules concern fault exchanges, not the point reversal required for
a transaction actually refunded under section 28.6.

### 28.6 Product Refund: Lucy Beauty Point Reversal

An eligible refund follows the applicable product return/refund policy.
Reverse the points attributable to the refunded amount through a linked
compensating adjustment in the Beauty wallet. Preserve the original award.

Example: an eligible 800,000 VND purchase earns 800 Beauty points. A full
eligible refund of 800,000 VND creates this retained historical sequence:

`PURCHASE +800 → REFUND_ADJUSTMENT -800`

Recalculate the valid Beauty balance and tier after the adjustment. For
example, 5,200 points (Diamond) minus 800 becomes 4,400 (Platinum).
Refund-driven tier decreases are allowed. Spa balance/tier is independent.
For partial refunds, use the attributable original paid amount/point
history; do not invent allocation or fractional-point reversal rules when
the necessary policy is not established.

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

### 30.9 Lucy Beauty Supplier Catalog Importer (FUTURE / NOT CURRENT PHASE)

**Status: future requirement. Not authorized for implementation in the
current phase, and not part of Phase 2. It extends sections 30.1-30.8
and belongs to Phase 9 --- Product Importer (section 56), built after
the Phase 6 product model.**

Business context: Lucy Spa may receive explicit permission from an
authorized distributor/supplier to reuse product information, images and
pricing from that supplier's website, and Lucy Beauty may contain too
many products for manual entry.

Only import content from supplier sources for which Lucy Spa has
authorization/permission to use the relevant content.

Potential source data:

-   Product name.
-   SKU/model.
-   Brand.
-   Category/subcategory.
-   Normal price.
-   Promotional price when available.
-   Descriptions and detailed product content.
-   Product attributes.
-   Product images.
-   Source URL/reference for traceability.

The importer should:

-   Associate images with the correct product.
-   Use deterministic image naming based on suitable identifiers such as
    brand/model/SKU.
-   Support multiple images per product.
-   Optimize images for web delivery.
-   Normalize source data into the Lucy Beauty product model.
-   Prefer structured source data over AI inference; use AI
    classification/normalization only when useful and reviewable.
-   Detect duplicates and changes between repeated imports.

Repeated imports should distinguish states such as `NEW`, `UNCHANGED`,
`PRICE_CHANGED`, `CONTENT_CHANGED`, `IMAGE_CHANGED`, `SOURCE_REMOVED` and
`DUPLICATE` / `NEEDS_REVIEW` (extending the re-import preview in
section 30.6).

Commercial safety:

-   The importer must **not** silently change sensitive commercial data
    such as active selling prices. Captured supplier prices are reference
    data for review; section 30.5 still applies. Any price change goes
    through the applicable Lucy Spa authorization/approval rules.
-   A product disappearing from the supplier website must **not**
    automatically delete or deactivate the Lucy Beauty product.
-   A Preview/Review stage is required before approved data becomes part of
    the live Lucy Beauty catalog.

#### 30.9.1 Goal: Low-Manual-Work, Multi-Source Synchronization

The importer is a low-manual-work, multi-source supplier catalog
synchronization system. The Owner should **not** have to manually
download images, copy product text, rename files, enter prices, classify
products, compare websites or work out what changed. The system automates
those tasks as far as is safe.

The normal Owner workflow is **not**:

`download → rename → copy → paste → classify → enter price → upload`

The intended workflow is:

-   **System:** collects → normalizes → deduplicates → classifies →
    processes images → prepares candidate/draft products.
-   **Owner:** reviews → corrects exceptions if needed → approves.

#### 30.9.2 Supplier vs. Supplier Source

-   **Supplier** = the distributor/vendor organization.
-   **Supplier Source** = an authorized catalog/data source belonging to
    that supplier.

One Supplier may have many Supplier Sources. Do not assume one supplier
equals one website:

```text
Supplier A
├── Website Source A
├── Website Source B
├── Website Source C
└── Website Source D
```

Different sources of the same supplier may contain overlapping products,
duplicates, different subsets, products found on only one source, and
different prices, content or images for the same underlying product.

The architecture should allow further source types where useful (website,
API, CSV, Excel, structured feed, ZIP + manifest) without designing them
now. Every source remains identifiable for traceability.

#### 30.9.3 Aggregating All Sources

A scan covers all enabled sources of the same supplier. Candidates
represent underlying products, not source records:

```text
Website A: Product 1, Product 2, Product 3
Website B: Product 2, Product 4
Website C: Product 1, Product 5
→ candidates: Product 1, 2, 3, 4, 5   (not seven Lucy Beauty products)
```

A product does not need to appear on every source. A product found on
only one source is still a valid catalog candidate.

#### 30.9.4 Cross-Source Matching and Deduplication

The system attempts to recognize when records from different sources
represent the same underlying product.

-   Prefer strong identifiers: supplier product code, SKU, model,
    barcode, brand + model/variant, or other reliable structured
    identifiers.
-   A product title alone is **never** a reliable unique identifier.
-   Where deterministic matching is not possible, normalization, fuzzy or
    AI-assisted matching may be used.
-   Fuzzy/AI matching must **not** silently merge products when confidence
    is insufficient. Ambiguous cases become `POSSIBLE_DUPLICATE` /
    `NEEDS_REVIEW` for an authorized reviewer, who can eventually choose:
    Merge (same product), Keep separate, or Ignore candidate.

#### 30.9.5 Source Mappings

When several source records map to one Lucy Beauty product, the system
preserves which source records produced it:

```text
Lucy Beauty Product
├── Supplier Source A → supplier product record
├── Supplier Source B → supplier product record
└── Supplier Source D → supplier product record
```

This supports traceability, repeated synchronization, source-specific
changes and price observations, and knowing whether a product still
exists elsewhere when one source removes it. The final schema is a
future design decision.

#### 30.9.6 Automated Data Collection

For each authorized source, the importer automates, where the source
provides it:

-   Discovering product pages/records.
-   Product name; SKU/model/product code; barcode; brand;
    category/subcategory.
-   Normal/source price and promotional/source price.
-   Descriptions, detailed content, attributes/variants where applicable.
-   Product images.
-   Source URL/reference and other useful source metadata.

Structured source data is preferred over AI inference. AI assists
normalization/classification only where useful.

#### 30.9.7 Automated Image Pipeline

The Owner should not have to save, match, rename, resize, compress or
organize product images by hand. The importer should be capable of:

-   Downloading permitted product images.
-   Associating them with the correct source/product.
-   Preserving image order where meaningful.
-   Detecting duplicate images where practical.
-   Deterministic filenames from identifiers plus sequence, for example
    `brand-model-sku-01`, `brand-model-sku-02`, `brand-model-sku-03`.
-   Generating web-optimized derivatives and thumbnail/display versions.
-   Preserving source metadata for traceability.

Optimize for web performance without unnecessarily destroying source-image
quality. The exact format, storage and CDN strategy belong to
implementation.

#### 30.9.8 Automated Normalization and Classification

The importer proposes/maps Brand, Category, Subcategory, Product,
Variant/model, SKU and product attributes into the Lucy Beauty catalog
model.

-   Reuse existing Lucy Beauty brands/categories when a reliable match
    exists, instead of creating duplicates.
-   AI may help classify ambiguous data.
-   Low-confidence mappings become review items; they never silently
    create incorrect catalog structure.

#### 30.9.9 Draft/Review Stage and Bulk Approval

Automatically prepared products enter an import candidate / draft /
review state before becoming live. New supplier products never become
publicly live merely because the crawler found them.

Default lifecycle (exact state names belong to implementation):

`DETECTED → EXTRACTED → NORMALIZED → MATCHED / DEDUPLICATED → DRAFT / READY_FOR_REVIEW → APPROVED → IMPORTED / PUBLISHED` (as the catalog workflow allows)

Review should make it easy to verify product identity/name, images,
brand/category, SKU/model, source price, important content, duplicate
warnings and validation warnings.

Bulk review/approval is supported where safe: the Owner can eventually
**Approve All Ready Products** and separately review only
warnings/exceptions, rather than approving hundreds of obviously valid
products one by one.

#### 30.9.10 Manual and Scheduled Checking

-   **Manual:** an authorized user can trigger **Check Supplier Updates**,
    which scans the enabled sources of that supplier.
-   **Scheduled:** enabled sources may be scanned periodically. The
    cadence must be configurable (for example daily or another
    Owner-selected interval), never hard-coded.

Automatic checking means **automatic detection and preparation**. It
never means automatic publication of sensitive catalog changes.

#### 30.9.11 Repeated Synchronization and Change Detection

After the initial import, the Owner does not revisit supplier websites to
find changes. Each scan compares new observations with previous
observations and mappings and classifies changes, such as `NEW`,
`UNCHANGED`, `PRICE_CHANGED`, `CONTENT_CHANGED`, `IMAGE_CHANGED`,
`SOURCE_REMOVED`, `POSSIBLE_DUPLICATE` and `NEEDS_REVIEW`. More than one
change type may apply to a product if the design supports it.

Operations are exception-driven: `UNCHANGED` products normally need no
attention, so hundreds of unchanged products never create hundreds of
review tasks.

-   **New products detected later.** A product added to **any** configured
    source (for example only on Website C of four) is detected as `NEW`.
    The system may then extract its data, download permitted images,
    normalize fields, propose brand/category, optimize images, check
    duplicates and prepare a Product Draft. The Owner reviews and approves
    it without having to discover it.
-   **Source-level removal.** `SOURCE_REMOVED` is evaluated per source. If
    Product X disappears from Website A but remains on B and C, the system
    records "no longer found on Source A", **not** "the supplier no longer
    carries Product X". Only when it is missing from every relevant
    configured source may it be reported as absent from all known supplier
    sources. Even then the Lucy Beauty product is **never** automatically
    deleted, and **never** automatically deactivated for that reason alone.
    History is preserved and the item goes to review.
-   **Different source prices.** The same product may have different
    observed prices (for example 1,800,000 / 1,750,000 / 1,900,000 VND on
    three sites). The importer never decides that the Lucy Beauty selling
    price becomes the cheapest, highest, latest or any other source price.
    Source-specific price observations are preserved for review and
    traceability.
-   **Price changes.** Review shows the current Lucy Beauty selling price,
    the previous and newly observed source prices, and which
    supplier/source made the observation. The system may prepare a
    proposed change but never silently updates the live selling price. An
    authorized person approves any price change under the applicable
    pricing permissions (section 30.5 still applies).
-   **Content/image changes.** Differences are detected where practical,
    the new source data is preserved and prepared for review. Lucy
    Beauty's manually curated content is never silently overwritten unless
    a future field-level synchronization policy explicitly allows it for
    that field. The design distinguishes **supplier-observed data** from
    **Lucy Beauty curated/live data**, so repeated synchronization never
    destroys Owner edits.

#### 30.9.12 Notifications and Sync History

When a scheduled synchronization finds meaningful changes, the system can
notify the Owner/authorized user with a summary such as:

```text
Supplier update detected
15 NEW products · 8 PRICE_CHANGED · 4 CONTENT_CHANGED
3 IMAGE_CHANGED · 2 SOURCE_REMOVED · 1 POSSIBLE_DUPLICATE
```

No-change scans create no Owner work and no noisy notifications. The
channel belongs to implementation; no specific channel (Telegram, Zalo,
email, Messenger or another) is mandated here.

The design retains enough synchronization history to answer:

-   Which supplier and which source were checked, and when each source was
    last checked successfully.
-   When a source product was first seen and last seen.
-   What changed, and which source value was observed.
-   Which Lucy Beauty product it is mapped to, and whether the match was
    automatic or manually confirmed.
-   Whether a proposed change was approved, rejected, ignored or is still
    pending.

The full schema is a future design decision.

#### 30.9.13 Failure Isolation and Source of Truth

Failure of one source never invalidates successful scans of the others:

```text
Website A → success
Website B → success
Website C → temporarily unavailable   (recorded/reported as failed)
Website D → success                   (A, B and D results preserved)
```

A temporary crawler/source failure is never interpreted as all of that
source's products being removed. This is essential for `SOURCE_REMOVED`
detection.

Source of truth:

-   Supplier websites/sources = authorized **external information
    sources**.
-   Lucy Beauty Product Catalog = the **operational source of truth**
    after approved import.

Supplier synchronization must never become a way for an external website
to silently control Lucy Beauty's live catalog.

#### 30.9.14 Simple Supplier Source Onboarding

For an already configured Supplier, adding another website/source should
need as little Owner technical work as reasonably possible. The intended
Owner experience is approximately:

`Supplier → Add Source → Enter source URL → Test / Validate Source → READY`

After that, the importer and synchronization handle future work
(sections 30.9.10-30.9.11). The Owner should not normally need to
understand HTML, CSS selectors, crawling rules, APIs, image downloading,
parsing, normalization, deduplication or synchronization internals.

**Source discovery and validation.** When a URL is added, the system
attempts to:

-   Validate that the source is reachable.
-   Identify whether it appears to contain an accessible product catalog.
-   Discover product/catalog structure where practical.
-   Determine whether useful structured data, an API or a feed is
    available.
-   Perform a controlled sample extraction and show enough of it to
    confirm the source is interpreted correctly.

Conceptual source statuses include equivalents of `PENDING_VALIDATION`,
`READY`, `ADAPTER_REQUIRED`, `AUTHENTICATION_REQUIRED`, `SOURCE_ERROR` and
`DISABLED`. Exact names belong to implementation.

**Adapter fallback.** Not every website can be supported reliably from a
URL alone. A source may use unusual HTML, render its catalog with
JavaScript, use an internal/authorized API, require authentication, use
unusual pagination, change structure later, or otherwise need
source-specific extraction logic. The architecture therefore allows a
**Supplier Source Adapter / Connector** (extending the adapter abstraction
in section 30.8):

-   Generic sources are discovered/configured automatically where
    reliable.
-   A source-specific adapter is used when necessary, and it is configured
    or fixed once.
-   After the source becomes `READY`, normal imports and repeated
    synchronization are automated.

The adapter implementation is a future design decision.

**Test Source.** Before large imports or synchronization are enabled, an
authorized user can run **Test Source**. The result makes it easy to verify
a small sample: products discovered, name, SKU/model, price, images,
category/brand if detected, and source URL/reference. This keeps a
misread source from generating thousands of bad catalog candidates.

**Website structure changes.** If a previously working source changes
structure and can no longer be read reliably, the system:

-   Marks/reports the source as unhealthy (an equivalent of
    `ADAPTER_UPDATE_REQUIRED` / `SOURCE_ERROR`) for technical attention.
-   Stops trusting new extraction results from that source.
-   Preserves the previous successful observations.
-   Never interprets extraction failure as `SOURCE_REMOVED` for that
    source's products (section 30.9.13).
-   Never alters the live Lucy Beauty catalog automatically.

The Owner's workflow stays review-oriented. The Owner is never expected to
repair crawler logic.

**UX target.** For a supported supplier website, the normal Owner workflow
is close to:

`ADD URL → TEST → ENABLE`

After that, the system collects, processes, synchronizes and prepares
changes, and the Owner mainly reviews product, image and price correctness
and approves. This does **not** promise that every arbitrary website can be
fully auto-configured from a URL alone; the adapter fallback above always
remains available.

Architecture direction (end-to-end flow; this extends, and does not
compete with, the pipeline in section 30.2):

```text
ONE SUPPLIER
  ↓
MULTIPLE AUTHORIZED SOURCES
  ↓
Manual or Scheduled Scan
  ↓
Per-Source Extraction
  ↓
Normalization
  ↓
Cross-Source Product Matching / Deduplication
  ↓
Source Mapping
  ↓
Image Processing
  ↓
Compare with Previous Observations / Lucy Beauty Mapping
  ↓
Change Detection
  ↓
Prepare Product Drafts / Proposed Changes
  ↓
Notify Owner if meaningful changes exist
  ↓
Owner Review / Exception Review
  ↓
Bulk Approve Ready Items where safe
  ↓
Approve / Reject / Ignore
  ↓
LUCY BEAUTY PRODUCT CATALOG
```

The Lucy Beauty product database/catalog is the source of truth after
import. ZIP/manifest-based import/export may be supported as a transport
mechanism, but a ZIP file must never become the product source of truth.

Required ordering (everything in section 30.9 remains FUTURE / NOT
CURRENT PHASE):

1.  Define/build the Lucy Beauty Product / Brand / Category / Product
    Image model (Phase 6).
2.  Define the Supplier + Supplier Source + mapping/synchronization
    architecture.
3.  Build the Supplier Catalog Importer (Phase 9).
4.  Validate against a small, controlled sample from **all** relevant
    supplier websites/sources.
5.  Validate cross-source duplicate detection.
6.  Validate image processing and product classification.
7.  Validate repeated synchronization/change detection.
8.  The Owner reviews the results.
9.  Only then perform bulk real-catalog ingestion, and use the resulting
    Lucy Beauty catalog as the source for storefront/inventory/POS
    workflows as appropriate.

The importer should be available **before** the Owner has to manually
populate a large real product catalog.

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

Collaborator (CTV) compensation is the agreed pay of their work occurrences
(see 9.1), separate from official-employee compensation. Payroll references
those occurrences; it does not copy their amounts.

### 34.1 My Income (Thu nhập của tôi)

Every workforce member has a read-only view of their own compensation
information, built only from the authoritative sources that exist:

-   It never stores or duplicates financial amounts. It is a view of the same
    sources that payroll and finance use.
-   **CTV:** agreed pay of scheduled work occurrences, by day, week (Monday
    to Sunday) or calendar month, using each occurrence's branch-local work
    date. It shows the total, the count, per-occurrence details and the
    branch.
    -   Occurrences whose pay is not yet agreed are shown and counted as such,
        never as zero and never in the total.
    -   Cancelled occurrences do not count.
    -   The amount is agreed pay, not money received, paid or net.
-   **Official employee (including a manager):** the currently configured
    monthly base salary, never prorated or converted into daily, weekly or
    earned amounts.
-   **Trainee and Owner:** no compensation is invented.
-   Income sources that do not exist yet (service tour, commission, tips,
    adjustments) are shown as not yet available, never as zero amounts.
-   Historical CTV pay remains CTV pay after a change of classification.

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
-   Manual point adjustments, including wallet-specific corrections/refund
    adjustments and their original-event references.
-   Membership tier/discount, promotion and Birthday Reward configuration changes.
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

-   Independent Lucy Spa / Lucy Beauty point balances and derived membership tiers.
-   `PointLedger`, attributable to its wallet and originating paid amount/activity.
-   `PointLot` or equivalent historical earning-source grouping if useful;
    it must not introduce point expiration or spending for Member Discounts.
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
-   Prevent duplicate point awards for the same eligible paid amount/activity,
    including retries, split payments, fault exchanges and prepaid combo usage.
-   Preserve independent Spa/Beauty balances and pre-transaction tier selection.
-   Prevent Member Discount usage from consuming points.
-   Enforce ordinary promotion/Member non-stacking and best eligible discount;
    apply Birthday Reward combinations only as configured.
-   Prevent duplicate referral awards: exactly +10 Spa AND +10 Beauty points
    once after the genuinely new referred customer's first qualifying registered,
    completed and successfully paid Spa visit. Preserve that referrer's award
    if the referred transaction is later refunded/reversed.
-   Link point refund/correction adjustments to original events, preventing
    duplicate reversal effects and recalculating the affected current tier.
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

Loyalty balances and awards use whole points. Keep wallet attribution and
applied financial/point results reconstructable; do not invent unspecified
rounding, fractional carry or mixed-invoice allocation policies.

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
-   My Spa/Beauty point balances, histories and independent membership tiers.
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
-   Wallet-specific point earning/adjustment and membership tier calculation.
-   Pre-transaction tier and best eligible discount selection, including
    configured Birthday Reward combination rules.
-   Fixed one-time +10 Spa AND +10 Beauty referral reward.
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

Loyalty events must identify the corresponding wallet, source activity/paid
amount and applicable historical rule/result. Refund/correction events
reference the original event. A combo usage event must not award its purchase
points again; a refund of B's qualifying transaction must not reverse A's
protected referral introduction award.

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
-   Base loyalty conversion: `1,000 VND eligible amount actually paid = 1 whole point`.
-   Membership tier thresholds/discounts: the same locked table in section 18.5,
    evaluated independently for Spa and Beauty; benefits never consume points.
-   Ordinary promotion eligibility and best-discount selection under section 16.1.
-   Birthday Reward/Voucher type, value, eligibility, scope, conditions and
    combinations under section 19; no automatic birthday point multiplier.
-   Cash float target: initial `1,000,000 VND`.
-   Low-stock threshold.
-   Expiry-warning days.
-   Notification channel settings.

Sensitive configuration changes require permissions and audit logs.

The current tier table and fixed referral award are locked requirements,
not missing formulas to guess. Any later Owner-authorized changes to rules
must retain applied historical versions/results. No setting may silently
enable point expiry or make Member Discounts consume points.

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
-   Independent Spa/Beauty earning, balances and tiers; points remain valid
    indefinitely, with no automatic expiry or reset.
-   Every boundary in the locked tier table, including Platinum and Ruby;
    Member Discounts never spend points.
-   Pre-transaction tier selection and future-only upgrades after earning;
    adjustment/refund-driven tier decreases.
-   Best eligible ordinary promotion versus Member Discount without stacking,
    with staff-visible benefit selection.
-   Configurable Birthday Rewards, explicit stacking and Member-then-fixed-voucher
    calculation; no automatic point multiplier or fixed 50,000 VND reward.
-   Fixed referral +10 Spa AND +10 Beauty once after genuine-new-customer,
    registration, first qualifying completed visit and successful payment;
    no invoice-value scaling, later-visit rewards or refund clawback of A's award.
-   Eligible combo Member Discount and purchase earning once; usage/free sessions
    earn zero; separately paid extras follow normal rules.
-   Combo consumption.
-   No tour for free entitlement.
-   Tour versioning.
-   Product commission.
-   Inventory movements.
-   Stock reservation.
-   Product return reversals.
-   Product-fault exchange retention for same/lower value and eligible additional
    Beauty earning for higher value, distinct from actual-refund reversals.
-   Linked compensating point corrections preserving original events and tiers.
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

-   Independent, non-expiring Spa/Beauty point balances and permanent ledgers.
-   Shared membership tier table applied separately per wallet; no point spending
    for Member Discounts and correct pre-transaction tier timing.
-   Best eligible ordinary discount selection without promotion/Member stacking.
-   Configurable Birthday Rewards/Vouchers and explicit combination rules.
-   Fixed one-time +10 Spa AND +10 Beauty introduction award with retention
    after the referred transaction is refunded/reversed.
-   Reward catalog.
-   Reward entitlements.
-   Combo definitions.
-   Combo ownership/family usage.
-   Eligible combo purchase Member Discount and points once; no usage earning;
    extra paid services follow normal rules.
-   Linked point adjustments and recalculated current balance/tier, preserving
    history and the product-fault/refund distinctions when those flows arrive.

### Phase 6 --- Products and Inventory

See also section 24.1 (future Promotion/Campaign Management) for the
"Promotions" deliverable.

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
-   Beauty product-fault exchange versus actual-refund point effects under
    sections 28.5-28.6, integrated with the Phase 5 ledgers and tiers.

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

See also section 30.9 (Lucy Beauty Supplier Catalog Importer, future
extended requirements). Build it on the Phase 6 product model and
validate it on a small sample before bulk ingestion. The Owner should
not have to populate a large real catalog manually before it exists.

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

### Future Implementation Milestones (unnumbered)

-   **Customer-facing premium motion system**: section 4.4. Implement
    when the customer-facing website UI/design system is built and its
    layout and design language are stable. Not part of Phase 2 and not
    applied to workforce/admin dashboards.

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
-   Reward catalog issuance thresholds/items, separate from membership tiers.
-   Actual Birthday Reward/Voucher configuration and supported combination rules.
-   Campaign-specific eligibility, values and unresolved benefit details within
    the locked ordinary promotion/Member selection rule.
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

| Rule | Current value |
| --- | --- |
| Business hours / lunch break | 09:00--21:00 / none |
| Booking hold for late arrival | 20 minutes |
| Late cancellation manager alert | Less than 15 minutes before booking |
| KTV Start/End warning | 5 minutes |
| KTV may accept next customer before current End | No |
| KTV may enter arbitrary service price | No |
| Price authority | Owner / authorized high-level manager |
| Combo expiry | No expiry |
| Service/combo refund | No |
| Point balances | Independent Lucy Spa Points and Lucy Beauty Points |
| Base earning in each wallet | 1 whole point / 1,000 VND eligible amount actually paid after discounts/vouchers; award after successful payment |
| Point expiry | Never; no automatic reset or rolling expiry |
| Tier thresholds and percentages | Same locked table in section 18.5, applied independently to each wallet |
| Tier for a transaction | Valid balance before the transaction earns points; no retroactive discount upgrade |
| Member Discount consumes points | No; no milestone-spending workflow |
| Ordinary promotion versus Member Discount | Automatically select the financially better eligible discount; do not stack; show staff the selection |
| Birthday benefit | Owner-configured reward/voucher type, value, eligibility, scope, period/conditions and combinations; no automatic point multiplier |
| Fixed Birthday Voucher allowed with Member Discount | Apply Member Discount, subtract configured voucher, then earn from final eligible paid amount; 50,000 VND is only an example |
| Referral identifier / relationship | Customer phone number / permanent |
| Referral qualification | Genuinely new customer, first Spa visit, successful registration, first qualifying service/customer visit completed and paid |
| Referral award | +10 Spa AND +10 Beauty points to A once per qualifying B; independent of invoice value; no later-visit award |
| Referral award after B refund/reversal | A keeps the already-earned introduction award |
| Combo purchase | Applicable Spa Member Discount allowed on eligible combos, including included bonus sessions; earn Spa points once on successful paid purchase |
| Combo session consumption | No new points, including free/gift sessions |
| Extra service outside a combo | Normal applicable Spa discount/payment/point rules on the newly paid service |
| Beauty product-fault exchange | Retain original points; add only eligible higher-value difference points; same/lower value does not duplicate/reduce points |
| Beauty actual refund | Reverse attributable points through a linked adjustment; current Beauty tier may decrease |
| Incorrect payment/point award | Authorized compensating adjustment with reason, actor, time and original-event reference; recalculate balance/tier |
| Cosmetics earn base points | Yes, in Lucy Beauty Points |
| Tips earn points | No |
| Point transfer / merging / conversion to cash | No, including between Spa and Beauty or between customers |
| Points usable as partial payment | No |
| Free combo/reward service earns KTV tour | No |
| Source-site product prices adopted automatically | No |
| Importer writes directly to live catalog without review | No |
| Initial cash float target | 1,000,000 VND, configurable |
| KTV cash withdrawal permission | No |
| Multi-branch architecture | Yes, from V1 |
| Online product shipping | Future/TBD |
| Zalo | Future/integration phase |
| Physical payment speaker | Future/integration-specific |

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
-   Exact cosmetic campaign thresholds, bonus/gift details and permitted
    combinations not already fixed by section 16.1.
-   Actual Birthday Reward/Voucher type, value, eligibility, scope,
    validity/conditions and combination rules until configured.
-   Ambiguous mixed-invoice discount/voucher/payment allocation between
    Spa and Beauty, including partial-refund point attribution.
-   Fractional-point remainder, rounding/aggregation boundaries or carry
    handling where the whole-point rule does not determine a result.
-   Treatment of a valid reversal exceeding the current point balance,
    already-consumed campaign benefits, and valuation of unlike promotional
    benefits where no applicable rule is established.
-   Public-vs-internal review publishing policy.
-   Automatic attendance-based payroll deductions.
-   Tax/e-invoice integration.
-   Final hosting/storage providers.

The membership table, ordinary best-discount/non-stacking rule and fixed
one-time +10 Spa AND +10 Beauty referral reward are resolved locked rules,
not TBD formulas. Do not change them while filling in unrelated details.

------------------------------------------------------------------------

## 62. Launch Acceptance Scenarios

Before V1 production launch, the system should successfully demonstrate
at least these end-to-end scenarios:

### Scenario A --- New Member Booking

Customer registers → email OTP verifies → books multiple services →
selects qualified KTV → receives confirmation → arrives → staff marks
arrived → KTV Starts/Ends → invoice uses the pre-transaction Spa tier and
applicable benefit → customer pays → Spa points awarded once from eligible
paid service amount → future tier updated → invoice visible.

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
correct service session → no new points at usage time → no tour generated
for free bonus entitlement → history remains auditable.

### Scenario E --- Product Sale

KTV sells product → system uses configured price → KTV cannot change
price → best eligible ordinary discount selected using the pre-transaction
Beauty tier → stock decreases → Beauty points awarded once from eligible
paid amount → seller commission recorded → invoice snapshots applied rules/results.

### Scenario F --- Birthday

Owner configures a fixed Birthday Voucher that is eligible to combine with
membership. Example configuration only: original eligible amount 500,000
VND, Diamond 7% → 465,000 VND; configured 50,000 VND voucher → 415,000 VND
paid → 415 points in the corresponding wallet. No automatic point
multiplier. Changing the configured type/value/conditions changes future
eligible behavior without rewriting this transaction; no benefit is
assumed to stack without its configured rule.

### Scenario G --- Referral Chain

A permanently refers B → verify B is genuinely new, successfully registered
and on their first qualifying completed/paid Spa visit → A receives exactly
+10 Spa AND +10 Beauty points once, regardless of B's invoice value.
B's later visits give A no further referral award; later refund/reversal
of B's qualifying transaction does not claw back A's award. B may later
refer C and receive the same fixed award only when C independently meets
all those conditions.

### Scenario H --- Inventory Count Difference

System stock 20 → physical count 19 → authorized manager records -1
adjustment with reason → audit log created → no silent stock overwrite.

### Scenario I --- Lucy Beauty Refund

Eligible 800,000 VND product refund approved under the retained return policy
→ preserve original `PURCHASE +800` → create `REFUND_ADJUSTMENT -800`
→ Beauty balance 5,200 (Diamond) becomes 4,400 (Platinum) → other applicable
money/reward/commission effects recorded → stock restored only if sellable.
Spa balance is unchanged; a referrer's protected introduction award remains.
The original financial/point history is retained.

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

### Scenario M --- Independent Tiers and Transaction Timing

Customer has 980 Spa points (Silver). Eligible service 100,000 VND less 3%
→ 97,000 VND paid → +97 Spa points → 1,077 Spa points (Gold). Gold 4% starts
with the next eligible transaction. Beauty points/tier do not change.
Both balances retain valid points indefinitely and neither Member benefit
spends points. Another customer may simultaneously be Spa Diamond and
Beauty Gold; each eligible portion uses its corresponding tier.

### Scenario N --- Ordinary Promotion Selection

Diamond 7% competes with an eligible 15% sale on 500,000 VND → automatically
select 15% only → 425,000 VND paid → 425 points in the corresponding wallet.
Staff can explain the selected benefit; not using the Member Discount does
not lower the tier. Repeat with a 5% sale: choose the eligible 7% Member
Discount, without stacking or point deduction.

### Scenario O --- Combo Purchase, Usage and Extra Service

Eligible 1,000,000 VND combo includes promotional sessions. Diamond 7%
Member Discount is allowed → 930,000 VND paid → +930 Spa points once.
Later paid/bonus prepaid session usage gives 0 new points. An additional
eligible 200,000 VND service outside the combo follows normal Spa benefit
selection/payment/earning on its actual paid amount. Combo remains
non-expiring and free bonus/gift sessions generate no tour compensation.

### Scenario P --- Lucy Beauty Product-Fault Exchange

Original eligible 500,000 VND purchase earns +500 Beauty points. In an
eligible fault exchange, a 600,000 VND replacement with an eligible
100,000 VND additional amount earns only +100 more; a same-value replacement
earns no more; a 400,000 VND replacement retains the original 500 points.
None rewrites the original award. These are fault-exchange cases, not the
actual-refund flow in Scenario I or a general voluntary-return exception.

### Scenario Q --- Incorrect Payment Correction

Staff mistakenly confirms a payment → +500 points recorded → authorized
manager records linked -500 adjustment with reason, actor and timestamp
→ original and correcting events remain visible → affected valid wallet
balance/tier recalculated, including a decrease when below a threshold.
No historical event is deleted or edited.

------------------------------------------------------------------------

## 63. Final Product Direction

Lucy Spa V1 should be built as a reliable operating foundation rather
than a collection of disconnected screens.

The core architecture must preserve the following long-term
capabilities:

`Customer → Booking → Visit → Service/Product → Invoice → Payment`

`Employee → Skill → Service Execution → Tour/Commission/Tip → Payroll`

`Product → Inventory → Sale → Return`

`Customer → Independent Spa/Beauty Points and Tiers → Membership Benefits`

`Customer → Referral/Combo/Reward`

`Branch → Employees/Bookings/Inventory/Cash/Reports`

`Authorized Product Source → Import Draft → Review → Catalog`

All financial, inventory, loyalty and compensation effects must be
traceable to the event that created them.

The system should be straightforward for Lucy Spa staff to operate while
giving Owner strong control, visibility, historical accuracy and room to
expand.

------------------------------------------------------------------------

**END OF LUCY SPA PRD --- REQUIREMENT FREEZE V1**
