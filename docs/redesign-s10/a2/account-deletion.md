# A2: customer account deletion (session 10)

Owner brief A2 + Owner answer 3 (2026-10-16). Evidence file of the A2 worker: findings first, then the design, the files, the
migration, the tests and the readings that wait for the Owner.

## 1. Findings (investigated before the design)

| Area                                     | Finding (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                        | Consequence                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer row shape                       | `users_kind_credentials` CHECK (`migrations/20260923000000_.../migration.sql:478`) allows a CUSTOMER only as `ACTIVE` with email, verified email, phone and password hash all set.                                                                                                                                                                                                                                                         | Erasure is impossible without a migration: a new "deleted customer" branch is added (INACTIVE, `deleted_at` set, email/phone/password NULL).                                                                                                                                                                                                                                                |
| Users are permanent                      | `lucy_guard_user_identity` (same file :501) refuses DELETE of a user; ids are referenced RESTRICT by invoices, payments, bookings, audit.                                                                                                                                                                                                                                                                                                  | The account is erased in place (tombstone), never deleted. Invoices/payments keep their own code/amount and point at the tombstone.                                                                                                                                                                                                                                                         |
| Profile                                  | `customer_profiles.date_of_birth` NOT NULL, `address` NOT NULL + nonblank; deferred trigger `lucy_check_user_profile` (:562) requires a CUSTOMER to keep exactly one profile row.                                                                                                                                                                                                                                                          | Keep the row; the migration makes both columns nullable (NULL only for a deleted customer, guarded).                                                                                                                                                                                                                                                                                        |
| Password always present                  | Customer sign-in requires `password_hash` (`apps/api/src/auth/login.service.ts:75`), the CHECK above requires it for an ACTIVE customer, and a session rotates only against a password hash (`session.service.ts:241`). No email-code step-up exists for customers.                                                                                                                                                                        | A signed-in customer always has a password: re-authentication = the current password through `LoginService.proveCurrentPassword(..., { allowCustomer: true })` (`login.service.ts:264`), same budgets as the email change. No "Quên mật khẩu first" branch is needed.                                                                                                                       |
| Sessions                                 | `sessions.user_id`, `credential_version` / `authz_version` on users.                                                                                                                                                                                                                                                                                                                                                                       | `credentialVersion++`, `authzVersion++` and every live session revoked in the same transaction: every device is signed out.                                                                                                                                                                                                                                                                 |
| Auth flows                               | `auth_challenges.delivery_email_snapshot` holds the address; the cleanup job deletes terminal challenges and completed registration intents within 24 h (`packages/server/src/auth-cleanup.ts:87-125`).                                                                                                                                                                                                                                    | Live challenges of the user are invalidated (and their pending deliveries erased); the existing cleanup then removes them and the completed registration intent.                                                                                                                                                                                                                            |
| Combo sessions (money)                   | `combo_purchases` / `combo_sessions`; the customer page counts free sessions with `lucy_combo_purchase_usable` (`apps/api/src/loyalty/customer-loyalty.core.ts:129-204`).                                                                                                                                                                                                                                                                  | Blocker (Owner answer 3): a usable, not expired, not voided combo with at least one free session blocks deletion. Same rule as "Còn dùng được" on the member page.                                                                                                                                                                                                                          |
| Points                                   | `loyalty_wallet_accounts.balance_points` (SPA, BEAUTY); the ledger is append-only and has no "forfeit" kind.                                                                                                                                                                                                                                                                                                                               | Points are lost: shown on the explanation page; the ledger and wallet rows are left untouched (no invented ledger kind). The account can never sign in or be chosen as a payer again (POS/walk-in lookups require `status = 'ACTIVE'`: `pos/invoice.core.ts:1366`, `pos/combo-sale.core.ts:89`, `pos/product-sale.core.ts:63`, `walkin/walkin.core.ts:69`).                                 |
| Bookings                                 | `cancelCustomerBooking` (`apps/api/src/booking/booking.core.ts:374`) is the normal customer cancellation: it writes the cancellation and the `BOOKING_CANCELLED` outbox event that staff screens and the late-cancel alert follow.                                                                                                                                                                                                         | Every upcoming CONFIRMED booking is cancelled through that function inside the deletion transaction. A booking already checked in or in service, or an open visit, blocks deletion ("you are at the spa now").                                                                                                                                                                              |
| Customer notices for those cancellations | The booking notification consumer only notifies an ACTIVE customer (`apps/worker/src/notification-delivery.ts:199`).                                                                                                                                                                                                                                                                                                                       | The deleted customer gets no new inbox rows; staff still do.                                                                                                                                                                                                                                                                                                                                |
| Online orders                            | `online_order_states` view (`migrations/20261122000000_phase6_wave4_fulfilment/migration.sql:237`): UNPAID / TO_SHIP / WAITING_GOODS / SHIPPED / DELIVERY_FAILED / DONE / CANCELLED.                                                                                                                                                                                                                                                       | "Unfinished" = an unpaid order still awaiting payment, or a paid order not yet DONE or CANCELLED. Blocks deletion.                                                                                                                                                                                                                                                                          |
| Issued invoice                           | Every online order has a finalized invoice from checkout (`lucy_guard_product_order`, wave3b migration :394); e-invoice integration is a future item (PRD line 3860).                                                                                                                                                                                                                                                                      | "Issued invoice" is read as "the invoice was paid at least once" (`invoices.paid_seq >= 1`). Reading, pending Owner.                                                                                                                                                                                                                                                                        |
| Order personal data                      | `online_order_details.recipient_name/phone` (`schema.prisma:4506`), `product_orders.contact_name/phone` (copied from the recipient for online orders, `product-orders/online.order.ts:66`), `online_address_corrections` (staff corrections, only after payment). Guards: details frozen at checkout (`20261121000001_.../migration.sql:163`); a product order may change only its contact (wave3b :394); `customer_user_id` is immutable. | Never-paid online orders: recipient and contact name/phone cleared (migration relaxes NOT NULL and lets the guards accept exactly that erasure). Paid orders: kept. "Detached from the account": the order keeps the tombstone id (the guard keeps `customer_user_id` immutable, history is never rewritten) and every name it resolves to becomes the placeholder. Reading, pending Owner. |
| Saved addresses, cart                    | `customer_addresses` and `online_carts` have no guard.                                                                                                                                                                                                                                                                                                                                                                                     | Deleted.                                                                                                                                                                                                                                                                                                                                                                                    |
| Notifications                            | `notifications` (ids/enums only, no free text).                                                                                                                                                                                                                                                                                                                                                                                            | Archived (`archived_at`), kept as history.                                                                                                                                                                                                                                                                                                                                                  |
| Reviews                                  | `customer_reviews.comment` is free text written by the customer, guarded append-only (`20261211000000_phase8_customer_reviews`).                                                                                                                                                                                                                                                                                                           | Kept (tied to an invoice). Listed as a reading for the Owner (the comment may contain personal words).                                                                                                                                                                                                                                                                                      |
| Chat callbacks                           | `chat_callback_requests` hold a typed phone/name, not linked to the account; purged by their own job.                                                                                                                                                                                                                                                                                                                                      | Out of scope (not account data).                                                                                                                                                                                                                                                                                                                                                            |
| Referral                                 | `referrals` hold ids only.                                                                                                                                                                                                                                                                                                                                                                                                                 | Kept.                                                                                                                                                                                                                                                                                                                                                                                       |
| Audit                                    | `audit-read.service.ts:196-219` resolves actor/subject names from `users.full_name`. Web `auditArea` maps `CUSTOMER_` to "access" (`apps/web/src/i18n/audit.ts:211`).                                                                                                                                                                                                                                                                      | The new `CUSTOMER_ACCOUNT_DELETED` event (ids and counts only) shows in the existing screen under "access", named with the placeholder; no personal data.                                                                                                                                                                                                                                   |
| Email pipeline                           | The only sender is the sealed auth-OTP pipeline (`auth_deliveries`, AES-GCM payload, `packages/server/src/auth-delivery.ts`); it is bound to a challenge with a 6-digit code. `outbox_events.payload` is permanent plaintext JSON.                                                                                                                                                                                                         | A separate sealed row `account_deletion_emails` (same key ring, same erase-on-leave rule) + an outbox event with the row id only. The worker sends it and erases the ciphertext. The address is never stored in plaintext after the transaction.                                                                                                                                            |
| Privacy policy text                      | Section 5 of the published policy says deletion is asked "qua hotline hoặc email" and that issued invoices are kept (plan `fd-plan-customer-2.md:544`).                                                                                                                                                                                                                                                                                    | Draft of the added text in `docs/redesign-s10/privacy-deletion-draft.md`; the published page and its CMS data are not changed.                                                                                                                                                                                                                                                              |

## 2. Design

- **Flow:** Hồ sơ (last group "Xóa tài khoản", destructive outline link) -> `/[locale]/account/profile/delete` (its own page with the
  Back chevron, no tabs): blockers card (only when something blocks), one card "what is deleted / what Lucy Spa keeps / what you
  lose" (points balance, the upcoming bookings that will be cancelled), and, only when nothing blocks, the confirm card: current
  password (label, `autocomplete="current-password"`, inline error, focus moves to it on a missing password) and the footer
  **Hủy** (neutral link back to Hồ sơ) then **Xóa tài khoản vĩnh viễn** (`danger-outline`, trash icon, `type="button"`). The form's
  submit is swallowed, so Enter never deletes; nothing has autofocus; no filled button anywhere. Success: `announceSessionChange()` and
  `router.replace('/[locale]/account/deleted')` (outside the member guard): h1, one sentence, secondary "Về trang chủ".
- **Plan deviations (brief wins):** the plan's Drawer/Sheet + filled danger confirm became one page with a danger-outline button (brief:
  "destructive button = the kit danger-outline variant, never primary"); upcoming bookings are cancelled, not a blocker (brief: "points
  and upcoming bookings are lost"); no "I understand" checkbox (the password is the deliberate step).
- **Server, one transaction under the user row lock (`runCustomerCommand`):** password proof first (shared reauth budgets), then
  re-check blockers -> cancel CONFIRMED upcoming bookings with `cancelCustomerBooking` (reason "Khách đã xóa tài khoản") -> erase the
  user row -> erase the profile -> clear recipient/contact of never-paid cancelled online orders -> revoke every session, invalidate
  live auth flows -> delete saved addresses and the cart -> archive notifications -> seal the confirmation email -> audit
  `CUSTOMER_ACCOUNT_DELETED` (`after` = counts only). Any failure rolls everything back.
- **Blockers:** usable unexpired combo with free sessions (Owner answer 3); unfinished orders: online awaiting payment, online paid
  and not DONE/CANCELLED, counter pre-order line AWAITING_PAYMENT/PAID/ORDERED/ARRIVED; a booking ARRIVED/IN_SERVICE or a visit
  OPEN/IN_SERVICE; an OPEN product return case on the customer's invoices.
- **Email:** `account_deletion_emails` row (AES-GCM, key ring `AUTH_DELIVERY_*`, binding = row id) + outbox event with the row id;
  the worker loop (`startAuthJobs`, only with SMTP configured) sends with the existing SMTP transport and erases the ciphertext when
  the row leaves PENDING (24 h deadline, 5 attempts). Body: the fact, the date (Vietnam time), what was removed/kept, "not you? call
  the shop"; no link, no name. The API refuses to start a deletion without the key ring (503, nothing deleted). The bounded auth
  cleanup (`packages/server/src/auth-cleanup.ts`, runs even with mail disabled) expires a row still PENDING past its deadline and
  erases its ciphertext (new summary field `expiredDeletionEmails`; `email-dispatch.integration.test.ts` updated to expect it).
- **Sign-out on the web:** `deleteAccount` drops the cached CSRF context after the 204, so the session refresh that
  `announceSessionChange()` triggers reads "signed out" instead of meeting a 401 (which would redirect to the sign-in page before the
  confirmation page opens). A blocker that appears between the check and the press refetches the check and shows a warning notice
  above it.
- **View transition:** route fade only (no shared element).

## 3. Files (file:line)

| File                                                                                                                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/database/prisma/migrations/20261216000000_customer_account_deletion/migration.sql`                                                         | New migration (section 4).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/database/prisma/schema.prisma`                                                                                                             | `User.deletedAt`; `CustomerProfile.dateOfBirth/address` nullable; `ProductOrder.contactPhone` nullable; `OnlineOrderDetail.recipientName/Phone` nullable; model `AccountDeletionEmail`.                                                                                                                                                                                                                                                          |
| `packages/contracts/src/account-deletion.ts`, `index.ts`                                                                                             | `AccountDeletionCheckResponse`, `AccountDeletionRequest`, order kinds.                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/server/src/account-deletion-email.ts`, `index.ts`                                                                                          | Event type, envelope, sealing binding, parser, `NoticeEmailTransport`.                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/api/src/account/account-deletion.core.ts:27-30`                                                                                                | Placeholder name, booking cancel reason.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/api/src/account/account-deletion.core.ts:33,57,181`                                                                                            | `unfinishedOrderKind`, `comboSessionsLeft`, `deletionFacts` (the check).                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/api/src/account/account-deletion.core.ts:244,333`                                                                                              | `eraseCustomerAccount`, `queueConfirmationEmail`.                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/api/src/account/account-deletion.service.ts:39,54,80,94`                                                                                       | check, delete (proof, re-check, `ACCOUNT_DELETION_BLOCKED`, audit).                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/api/src/account/account-deletion.controller.ts:21,28,39`                                                                                       | `GET`/`POST /api/v1/me/account-deletion`; POST clears the cookie.                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/api/src/auth/auth.error.ts`                                                                                                                    | New code `ACCOUNT_DELETION_BLOCKED` (409).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/api/src/app.module.ts`                                                                                                                         | Controller and service registered.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Ripple of the nullable columns                                                                                                                       | `account/customer-profile.service.ts:29`, `online-orders/online.fulfilment.ts:172`, `online-orders/online.present.ts:101`, `pos/discount.eval.ts:280`, `product-orders/order.commands.ts:234`, `product-orders/order.core.ts:123`, `product-orders/order.queue.ts:199,274` (erased value shown as empty; a missing birthday gives no birthday gift); test typings in `customer-profile.integration.test.ts`, `registration.integration.test.ts`. |
| `apps/worker/src/account-deletion-email.ts:71,120,270`                                                                                               | Template (vi/en), processor, dispatcher.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/worker/src/auth-jobs.ts:132`                                                                                                                   | Dispatch loop next to the auth emails.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/components/customer/screens/profile.tsx:204-215`                                                                                       | The new last group with the danger-outline link.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/web/src/components/customer/screens/account-deletion.tsx:35,67,87,159,176,251`, `apps/web/src/components/customer/screens/account-deleted.tsx` | Screen, view, blockers, order code span, consequences, confirm form; the deleted page (server component).                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/app/[locale]/(site)/account/(app)/profile/delete/page.tsx`, `.../account/deleted/page.tsx`                                             | Routes.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/lib/customer/account-deletion.ts`                                                                                                      | API calls, refund-policy slug, advice/link/error helpers.                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/i18n/customer-profile.ts:54-105,156-207`                                                                                               | vi/en texts.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/ui/src/s10-account.css` (A2 block at the end)                                                                                              | `ls-acct-del*` classes (used only by the deletion screen).                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/test-product-integration.mjs`                                                                                                               | Registers the new integration test.                                                                                                                                                                                                                                                                                                                                                                                                              |

## 4. Migration `20261216000000_customer_account_deletion`

Additive (no data change; existing rows satisfy every new check): adds `users.deleted_at`; replaces `users_kind_credentials` with a
third CUSTOMER shape (INACTIVE, deleted, email/phone/password NULL, name "Tài khoản đã xóa"; live shapes require `deleted_at IS NULL`);
trigger `users_deletion_guard` (a deleted account stays deleted); `customer_profiles.date_of_birth/address` DROP NOT NULL + "erased
together" check + trigger (NULL only for a deleted account, never written again); `product_orders.contact_phone` DROP NOT NULL + check
rewritten + `lucy_guard_product_order` replaced (same body plus: a new order always has a phone; the contact may be cleared only for a
cancelled, never-paid online order of a deleted account; an erased contact stays erased); `online_order_details.recipient_name/phone`
DROP NOT NULL + checks rewritten + `lucy_guard_online_order_details` replaced (frozen except that one erasure); new table
`account_deletion_emails` with the `auth_deliveries` lifecycle checks, guard and no-truncate trigger; the Phase 1 search_path/REVOKE
convention for every function created or replaced. Verified: applied cleanly on a throw-away database (`lucy_spa_a2test_20261016`,
created and dropped by this worker; no shared database touched).

## 5. Tests and results

| Command                                                                                                                                                                                              | Result                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `node --test dist/account/account-deletion.core.test.js dist/account/account-deletion.http.test.js dist/account/customer-profile.http.test.js` (apps/api, after `pnpm --filter @lucy-spa/api build`) | 5/5 pass                                                                                                 |
| `node --test dist/account-deletion-email.test.js dist/auth-jobs.test.js` (apps/worker)                                                                                                               | 8/8 pass                                                                                                 |
| Throw-away DB: `account-deletion`, `customer-profile`, `registration`, `online.checkout`, `online.fulfilment`, `online.refunds` integration (`RUN_AUTH_INTEGRATION=true`)                            | 44/44 pass                                                                                               |
| Throw-away DB: `order`, `order.commands`, `referral` (api) + `phase6-wave3b-orders`, `auth-schema` (database) integration                                                                            | 68/68 pass                                                                                               |
| `pnpm --filter @lucy-spa/web exec node --import tsx --test` account-deletion.test.tsx, profile.test.tsx, lib/customer/profile.test.ts, lib/workforce/audit.test.ts, account-frame.test.tsx           | all pass (21 + 15 incl. overlap)                                                                         |
| `src/test/ui-ratchet.test.ts` (web), `src/components-css.test.ts` (ui)                                                                                                                               | pass                                                                                                     |
| `tsc --noEmit` api, worker, server, contracts (build), web                                                                                                                                           | clean; web reports 3 errors in `components/notifications/inbox.tsx` (another worker's file, not touched) |
| `eslint` on every A2 file                                                                                                                                                                            | clean                                                                                                    |
| `prettier --check` on every A2 file                                                                                                                                                                  | clean after `--write`                                                                                    |

Not covered by an automated test (reading for the lead): a booking actually cancelled by the deletion (the booking fixture needs the
availability engine; the path is the existing `cancelCustomerBooking`), and a combo blocker against the database (covered by the pure
`comboSessionsLeft` test and the same query as the member page).

## 6. Skills (contract: evidence per skill)

Invoked with the Skill tool: `frontend-design:frontend-design`, `web-design-guidelines` (rules fetched fresh with WebFetch from
`raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`; same categories as `.local/s10/wig-command.md`),
`react-best-practices` (rules applied: `rerender-no-inline-components`, `rerender-derived-state-no-effect`,
`rerender-move-effect-to-event`, `rendering-conditional-render`, `rendering-hoist-jsx`, `js-cache-function-results`,
`bundle-barrel-imports`, plus the contract's "server component where one works"), `react-view-transitions` (read
`references/implementation.md`, step 1 audit). Files reviewed: `components/customer/screens/account-deletion.tsx`,
`components/customer/screens/account-deleted.tsx`, `components/customer/screens/profile.tsx` (the A2 group, lines 204-215),
`app/[locale]/(site)/account/(app)/profile/delete/page.tsx`, `app/[locale]/(site)/account/deleted/page.tsx`,
`lib/customer/account-deletion.ts`, `packages/ui/src/s10-account.css` (A2 block). All paths below are under `apps/web/src/`.

### frontend-design critique of the deletion page

- **Hierarchy:** h1 "Xóa tài khoản" with one lead sentence. When something blocks, the blockers card comes first (the only thing the
  person can act on), then the consequences, and no password field at all. When nothing blocks: consequences, then the confirm card
  last. One reading order: why not / what happens / do it.
- **One clear destructive path:** a single destructive control per view: the danger-outline link on Hồ sơ, the danger-outline button
  on the deletion page. Cancel (neutral) always comes first in the footer. No filled button, no autofocus, Enter does not delete. The
  plan's Drawer/Sheet and filled danger confirm were dropped (brief: never primary).
- **Tells removed / avoided:** no ALL-CAPS labels, no eyebrows, no "→", no decorative numbering, no middle-dot meta strings, headings
  are text only (test pins it). The three consequence groups share one card, split by spacing and a hairline, not three boxed cards.
- **Copy plainness:** each blocker says what is wrong and what to do ("Hãy dùng hết…, hoặc yêu cầu hoàn tiền…", "Hãy hủy đơn, hoặc đợi
  hết hạn thanh toán"); the button says exactly what happens ("Xóa tài khoản vĩnh viễn"); no guilt or humour copy; never "khám".
- **Found and changed:** the "a blocker appeared" message could never be seen (the confirm card unmounted on the refetch). It is now a
  warning notice above the list (`account-deletion.tsx:48`), and its copy says "bên dưới".
- **Considered, kept:** the blockers card has no colour cue of its own. Its heading states it plainly and it comes first; headings
  stay text only (no icon or badge next to a heading).

### web-design-guidelines findings (`file:line rule`)

Before:

1. `components/customer/screens/account-deletion.tsx:320` Forms: the password input has `autocomplete` but no meaningful `name`.
2. `components/customer/screens/account-deletion.tsx:273` Forms: "focus first error on submit". A missing password showed the
   message but left the focus on the button.
3. `components/customer/screens/account-deletion.tsx:129,134` Locale & i18n: order codes (identifiers) are not marked
   `translate="no"`.
4. `components/customer/screens/account-deletion.tsx:48` Accessibility (async updates): the "blocker appeared" message unmounted
   before it could be announced (also the frontend-design finding).
5. `lib/customer/account-deletion.ts:29` Navigation & state: after the deletion, the session refresh could meet a 401 and redirect to
   the sign-in page before the confirmation page.

Fixed:

1. `name="current-password"`.
2. Focus moves to the field (`id` passed to `Field`, line 306).
3. `WithCode` renders the code as `<span translate="no">` (line 164); `aroundCode` splits the template (`lib/…/account-deletion.ts:57`).
4. A `Notice tone="warning"` (role status) above the refetched list.
5. `api.resetCsrf()` after the 204, so the refresh reads "signed out".

Checked and passing:

- Every input has a label.
- Errors are inline with `aria-describedby` (kit `Field`), and the busy label ends with "…".
- Dates and numbers use `Intl`.
- Long text wraps (`overflow-wrap: break-word`, `min-width: 0`).
- No `transition: all`, no `outline: none`.
- Navigation uses `<Link>`.
- The destructive action has its confirmation step: the page plus the password re-entry (brief: immediate deletion after the
  password).
- Link targets are 44 px tall (`ls-acct-del-links > a`).
- Title Case is not applied: the sentence-case override in DESIGN 17 and the contract wins.

Final: 0.

### react-best-practices findings

Before:

1. `components/customer/screens/account-deletion.tsx:171` `js-cache-function-results` / `rendering-hoist-jsx`: an
   `Intl.NumberFormat` was built on every render.
2. The contract's "no new client component where a server one works": the deleted page was a client component reading the locale
   from context.

Fixed:

1. Hoisted to the module constant `POINTS`.
2. `AccountDeletedScreen` moved to `components/customer/screens/account-deleted.tsx`, a server component. The route
   (`app/[locale]/(site)/account/deleted/page.tsx`) awaits `params`, checks the locale and passes it.

Checked and passing:

- No inline component definitions (`WithCode` is module level).
- State derived in render (`missing`).
- No effects; the interaction logic is in the event handler.
- Ternaries, not `&&`, for conditional JSX.
- Stable keys (ids; the static copy lines key by their text).
- Both route files are server components.
- `@lucy-spa/ui` imports follow the kit's single entry used by every screen (not a heavy third-party barrel).

Final: 0.

### react-view-transitions decision

- Navigation map: Hồ sơ -> /profile/delete (forward); /profile/delete -> Hồ sơ (Cancel, Back chevron); /profile/delete ->
  /account/deleted (after success, `router.replace`); /account/deleted -> home.
- No shared visual element exists between these views, no Suspense boundary (client fetch with the kit skeleton), and no list
  reorder.
- Decision: **route fade only** (the site's existing route fade). No new `<ViewTransition>`, no directional slide (session 10 rule:
  route fade only), and GSAP is not used on these pages.

Kit requests: none.

Validation after the fixes:

- Web tests (`account-deletion.test.tsx`, `profile.test.tsx`, `lib/customer/profile.test.ts`, `ui-ratchet.test.ts`): 19/19 pass.
- `tsc --noEmit` (web): no error in A2 files (errors remain only in other workers' files).
- eslint clean and prettier clean on every A2 web file.
- API and DB unchanged by this pass.

### Step 7 customer audit follow-up (kit-requests.md line 49, `[audit-customer]`)

Before (all paths under `apps/web/src/`):

1. `components/customer/screens/profile.tsx:210`, `account-deletion.tsx:116,117,133,331` and `account-deleted.tsx:23`:
   view transitions. The links had no `transitionTypes={NAV_TRANSITION}`, so the page snapped instead of using the site's route
   fade.
2. `account-deletion.tsx:133` Touch & Interaction (44 px target): "Xem đơn {code}" was a small inline link inside the advice
   sentence.
3. `i18n/customer-profile.ts:65,68` Content & Copy (consistent terms): the page said "gói dịch vụ" while the member page says
   "Combo" ("Combo của tôi").

Fixed:

1. Every link in the A2 files now carries `transitionTypes={NAV_TRANSITION}` (from `lib/nav-transition`).
2. The order link sits on its own line in a `p.ls-acct-del-links` (44 px min height). A new rule `.ls-acct-del-list p { margin: 0 }`
   was added to the A2 block of `s10-account.css`.
3. "combo" / "Xem combo của tôi" (en "combos" / "See my combos"). The change is recorded in `docs/redesign-s10/copy/account.md`, and
   the privacy draft uses the same term.

Tests now pin all three: the new copy, the absence of "gói dịch vụ", and the order link inside `ls-acct-del-links`.

Final: 0.

Validation:

- Web tests: 19/19 pass.
- `tsc --noEmit`: no error in A2 files.
- eslint and prettier: clean.
- Kit `components-css.test.ts`: 12/13. The one failure is the class `ls-rail`, which has no CSS rule; it is not an A2 class (another
  worker's kit change).

## 7. Readings pending Owner (not decided by this worker)

1. "Issued invoice" = the invoice was paid at least once (`paid_seq >= 1`); e-invoices do not exist yet.
2. "Unfinished orders" block: online awaiting payment or paid and not delivered; counter pre-orders not collected; open return
   requests; a booking or visit in progress. (The Owner did not define it; brief asked to record it as a reading.)
3. "Detached from the account": the order keeps the tombstone id (database guards keep `customer_user_id` immutable, history is never
   rewritten); the account behind it has no name, email, phone or password.
4. Points and unused gifts are lost without a ledger entry (no "forfeit" ledger kind exists); balances stay on the tombstone and can
   never be used. Reports that sum outstanding points still count them.
5. The address (street, ward, province) of a never-paid order is kept; only name and phone are cleared, as the Owner wrote.
6. Review comments are kept as written.
7. The refund-policy link uses the CMS slug `chinh-sach-doi-tra-hoan-tien`, also on the English site (`/en/chinh-sach-doi-tra-hoan-tien`,
   not verified to resolve there; the lead's capture should check it); renaming that page breaks the link.
8. Counter (non-online) pre-orders that were never paid keep `contact_name` / `contact_phone`: the Owner's rule names online orders,
   so the erasure (and the database guard) is limited to ONLINE orders.
9. The neutral name "Tài khoản đã xóa" is enforced by the database check; changing it needs a migration.
10. All new copy (`docs/redesign-s10/copy/account.md`) and the privacy draft (`docs/redesign-s10/privacy-deletion-draft.md`).
