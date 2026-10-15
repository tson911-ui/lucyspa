# Web Interface Guidelines audit: customer site

Scope: `apps/web/src/app/[locale]/(site)/**`, `components/{customer,public,shop,navigation,notifications,season}/**`,
`app/[locale]/layout.tsx`, i18n `site.ts customer*.ts online-shop.ts campaigns-public.ts notifications.ts season.ts`. Tests skipped.
Kit internals (`packages/ui`) not audited here (other agent). Project exception: sentence case expected; no Title Case found in
EN copy (all buttons/headings already sentence case). No `...`, no "Oops", no "click here"/"Nhấn vào đây"; every loading
label in scope ends with `…`. `Field` (kit) passes only `id`/aria props to its control, so the missing-`name` findings stand;
kit `MenuItem` accepts `href`, so the `router.push` menu findings are usage problems.

| Rule section               | Findings |
| -------------------------- | -------- |
| Accessibility              | 9        |
| Focus States               | 0        |
| Forms                      | 19       |
| Animation                  | 0        |
| Typography                 | 5        |
| Content Handling           | 1        |
| Images                     | 2        |
| Performance                | 1        |
| Navigation & State         | 13       |
| Touch & Interaction        | 1        |
| Safe Areas & Layout        | 0        |
| Dark Mode & Theming        | 1        |
| Locale & i18n              | 6        |
| Hydration Safety           | 0        |
| Hover & Interactive States | 0        |
| Content & Copy             | 7        |
| Anti-patterns              | 0        |
| **Total**                  | **65**   |

Grep sweep across scope found none of: `transition: all`, `outline: none`/`outline-none`, `user-scalable`/`maximum-scale`,
`onPaste`, `autoFocus`, `<div|span onClick>`, raw `<select>`/`<table>`/`<details>`, `<img>` without width/height, `.gif`,
`toLocale*`/`toFixed` date or number formatting, layout reads during render.

## apps/web/src/app/[locale]/layout.tsx

apps/web/src/app/[locale]/layout.tsx:29 - [Touch & Interaction] neither the imported `app/globals.css` nor any kit stylesheet sets `touch-action: manipulation` or `-webkit-tap-highlight-color` for the customer site's links/buttons (only `touch-action: none` exists in the kit). Hand-off: belongs in kit base CSS.

## apps/web/src/app/[locale]/(site)/layout.tsx

apps/web/src/app/[locale]/(site)/layout.tsx:8 - [Dark Mode & Theming] `themeColor` keyed only to `prefers-color-scheme`; the in-page ThemeCycle (light / dark / "Theo giờ") sets `data-theme`, so a dark page on a light-OS device keeps a white browser bar (and vice versa). Update the theme-color meta from the theme script.

## apps/web/src/app/[locale]/(site)/error.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/not-found.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/(home)/loading.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/(home)/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/[...rest]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/contact/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/products/(list)/loading.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/products/(list)/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/products/[code]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/services/(list)/loading.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/services/(list)/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/services/[code]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(public)/ticket/[token]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(shop)/cart/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(shop)/checkout/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/(shop)/layout.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/book/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/bookings/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/bookings/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/invoices/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/invoices/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/layout.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/loyalty/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/notifications/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/orders/[id]/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/orders/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/(app)/profile/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/forgot-password/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/layout.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/login/page.tsx

✓ pass

## apps/web/src/app/[locale]/(site)/account/register/page.tsx

✓ pass

## apps/web/src/components/public/account-menu.tsx

apps/web/src/components/public/account-menu.tsx:41 - [Navigation & State] every account-menu entry (sign in, register, account, cart, orders, rewards) navigates via `onSelect: () => router.push(...)` on a menu button: no Cmd/Ctrl/middle-click, no "open in new tab"; use link menu items.

## apps/web/src/components/public/brand-band.tsx

apps/web/src/components/public/brand-band.tsx:54 - [Images] logo `<img>` has no `loading="lazy"`; the band sits under the full-height hero (below the fold on phones) and repeats each logo up to 20×.

## apps/web/src/components/public/campaign-views.tsx

✓ pass

## apps/web/src/components/public/category-tile.tsx

✓ pass

## apps/web/src/components/public/chat-contact.tsx

✓ pass

## apps/web/src/components/public/chat-panel.tsx

apps/web/src/components/public/chat-panel.tsx:172 - [Forms] Send button `disabled={draft.trim() === ''}`; keep it enabled until the request starts and handle the empty case.
apps/web/src/components/public/chat-panel.tsx:264 - [Forms] callback form sets `errors` and returns, but never moves focus to the first invalid field (checkout already uses `focusFirstInvalid`).
apps/web/src/components/public/chat-panel.tsx:303 - [Forms] phone / name / note controls have no `name` attribute (autofill relies on it besides `autocomplete`).

## apps/web/src/components/public/contact-view.tsx

apps/web/src/components/public/contact-view.tsx:25 - [Accessibility] load-error state renders only a Notice: the page has no h1.

## apps/web/src/components/public/contact-widget.tsx

✓ pass

## apps/web/src/components/public/footer-blocks.tsx

✓ pass

## apps/web/src/components/public/home-content.tsx

apps/web/src/components/public/home-content.tsx:93 - [Locale & i18n] fallback brand name `'Lucy Spa'` in the hero h1 without `translate="no"`; browser auto-translate may translate the brand name.

## apps/web/src/components/public/home-product-row.tsx

✓ pass

## apps/web/src/components/public/home-sections.tsx

apps/web/src/components/public/home-sections.tsx:65 - [Accessibility] address link opens a new tab (`target="_blank"`) with no "(mở trong tab mới)" hint, unlike the contact page and footer links.

## apps/web/src/components/public/home-slider.tsx

✓ pass

## apps/web/src/components/public/info-view.tsx

apps/web/src/components/public/info-view.tsx:16 - [Accessibility] parse-failure state renders only a Notice: no h1 on the page.

## apps/web/src/components/public/lazy-product-row.tsx

✓ pass

## apps/web/src/components/public/notification-bell.tsx

✓ pass

## apps/web/src/components/public/page-transition.tsx

✓ pass

## apps/web/src/components/public/photo-slot.tsx

apps/web/src/components/public/photo-slot.tsx:26 - [Images] `<img>` has neither `loading="lazy"` nor `fetchPriority`: it is below the fold on the home intro (home-content.tsx:152) but the LCP image of the service page hero (services-view.tsx:154). Add a `priority` prop like `ProductImage`.

## apps/web/src/components/public/product-card.tsx

✓ pass

## apps/web/src/components/public/product-gallery.tsx

✓ pass

## apps/web/src/components/public/product-image.tsx

✓ pass

## apps/web/src/components/public/product-offer.tsx

✓ pass

## apps/web/src/components/public/products-controls.tsx

apps/web/src/components/public/products-controls.tsx:43 - [Forms] search placeholder is the label again ("Tìm mỹ phẩm"): no `…`, no example pattern.

## apps/web/src/components/public/products-view.tsx

apps/web/src/components/public/products-view.tsx:390 - [Accessibility] "Chỉ đường" opens a new tab with no new-tab hint.

## apps/web/src/components/public/promo-popup.tsx

✓ pass

## apps/web/src/components/public/public-breadcrumbs.tsx

✓ pass

## apps/web/src/components/public/rich-text.tsx

✓ pass

## apps/web/src/components/public/sale-countdown.tsx

✓ pass

## apps/web/src/components/public/sale-price.tsx

✓ pass

## apps/web/src/components/public/scroll-row.tsx

✓ pass

## apps/web/src/components/public/service-book-bar.tsx

✓ pass

## apps/web/src/components/public/services-list.tsx

apps/web/src/components/public/services-list.tsx:104 - [Navigation & State] service search kept in `useState` only: not in the URL (the product list keeps `q` in the URL), so it is not shareable and is lost on Back/reload.
apps/web/src/components/public/services-list.tsx:125 - [Forms] placeholder = label ("Tìm dịch vụ"): no `…`, no example.
apps/web/src/components/public/services-list.tsx:139 - [Performance] every service of every group is rendered as a card (Reveal + image) with no virtualization or `content-visibility: auto`; matters only if the catalogue passes ~50 services (the booking step lists the same set at book.tsx:487).

## apps/web/src/components/public/services-view.tsx

apps/web/src/components/public/services-view.tsx:120 - [Accessibility] failed-read state of a service page has a Back link and a notice but no h1 (the product page's same state has one).

## apps/web/src/components/public/shared-photo.tsx

✓ pass

## apps/web/src/components/public/site-chrome.tsx

✓ pass

## apps/web/src/components/public/site-chrome-client.tsx

✓ pass

## apps/web/src/components/public/site-fonts.ts

✓ pass

## apps/web/src/components/public/site-page-frame.tsx

✓ pass

## apps/web/src/components/public/site-scroll-manager.tsx

✓ pass

## apps/web/src/components/public/site-session.tsx

✓ pass

## apps/web/src/components/public/ticket-view.tsx

apps/web/src/components/public/ticket-view.tsx:94 - [Locale & i18n] the pick-up code read out at the counter (`ticket.code`) has no `translate="no"`; browser translation can alter it.

## apps/web/src/components/public/unbroken.tsx

✓ pass

## apps/web/src/components/customer/account-frame.tsx

✓ pass

## apps/web/src/components/customer/shell.tsx

✓ pass

## apps/web/src/components/customer/session.tsx

apps/web/src/components/customer/session.tsx:170 - [Accessibility] the error state and the staff-session state (:182) render a `<p role="alert">` and a button only: no h1 on the page.

## apps/web/src/components/customer/screens/auth.tsx

apps/web/src/components/customer/screens/auth.tsx:302 - [Forms] OTP format error goes to the top Notice, not inline on the code field, and focus is not moved to the field (same at :601 in forgot-password).
apps/web/src/components/customer/screens/auth.tsx:406 - [Forms] password length / mismatch shown in the top Notice instead of on the password fields; no focus to the first error.
apps/web/src/components/customer/screens/auth.tsx:483 - [Forms] placeholder `"dd/mm/yyyy"` is a hardcoded English literal (the vi hint says "Ngày/tháng/năm"), not from i18n.
apps/web/src/components/customer/screens/auth.tsx:381 - [Forms] the 7-field register form has no unsaved-changes guard; the Đăng nhập/Đăng ký switch (:78) and every header link drop typed data silently.
apps/web/src/components/customer/screens/auth.tsx:244 - [Forms] no `name` on any TextInput/PasswordInput in the login, register and reset forms.

## apps/web/src/components/customer/screens/book.tsx

apps/web/src/components/customer/screens/book.tsx:120 - [Navigation & State] wizard step lives in `useState`: browser/phone Back leaves the booking instead of returning to the previous step; steps are not deep-linkable.
apps/web/src/components/customer/screens/book.tsx:394 - [Forms] Next/Confirm is `disabled={!nav.canContinue}` with no message saying what is missing (e.g. no start time picked); keep enabled and point at the missing choice.
apps/web/src/components/customer/screens/book.tsx:118 - [Forms] 4-step flow has no unsaved-changes guard; a header/tab-bar tap discards all choices.
apps/web/src/components/customer/screens/book.tsx:472 - [Forms] search placeholder = label ("Tìm dịch vụ"): no `…`, no example.
apps/web/src/components/customer/screens/book.tsx:728 - [Locale & i18n] slot times are printed as received (`title={start}`, also `${date} · ${draft.startTime}` at :747), not passed through the shared Intl time formatter (`formatTime`) used for every other time.
apps/web/src/components/customer/screens/book.tsx:896 - [Navigation & State] "Bỏ" removes a guest and resets its service assignments immediately: no confirm or undo.

## apps/web/src/components/customer/screens/bookings.tsx

apps/web/src/components/customer/screens/bookings.tsx:107 - [Accessibility] `NotFoundPage` uses the list title ("Lịch hẹn của tôi") as the page h1 on a not-found page; the heading does not describe the page.
apps/web/src/components/customer/screens/bookings.tsx:190 - [Navigation & State] row menu "Xem chi tiết" navigates with `router.push` from a menu button (no new-tab / middle-click).

## apps/web/src/components/customer/screens/invoices.tsx

apps/web/src/components/customer/screens/invoices.tsx:140 - [Navigation & State] row menu "Xem chi tiết" navigates with `router.push` (no link semantics).
apps/web/src/components/customer/screens/invoices.tsx:163 - [Navigation & State] "Xem thêm" pages held in `useState`; reload or Back from a detail page loses the loaded pages and scroll position.

## apps/web/src/components/customer/screens/loyalty.tsx

apps/web/src/components/customer/screens/loyalty.tsx:145 - [Locale & i18n] percent built by hand (`${bp / 100}%`, also `${row.discountPercent}%` at :207); use `Intl.NumberFormat(…, { style: 'percent' })` (vi decimal is a comma).
apps/web/src/components/customer/screens/loyalty.tsx:178 - [Accessibility] tier table is `div role="table"/"row"/"cell"`; use a semantic `<table>` (or the kit DataTable/InfoTable) before ARIA.
apps/web/src/components/customer/screens/loyalty.tsx:233 - [Navigation & State] each section's page number in `useState`; not in the URL, lost on reload/Back.

## apps/web/src/components/customer/screens/notifications.tsx

✓ pass

## apps/web/src/components/customer/screens/profile.tsx

✓ pass

## apps/web/src/components/customer/screens/review-card.tsx

apps/web/src/components/customer/screens/review-card.tsx:178 - [Forms] "Gửi đánh giá" is `disabled={request === null}` until a star rating is chosen; the existing `errors.invalid` text can never be shown. Keep enabled and show the inline error.

## apps/web/src/components/shop/cart-link.tsx

✓ pass

## apps/web/src/components/shop/cart-screen.tsx

apps/web/src/components/shop/cart-screen.tsx:273 - [Navigation & State] trash button removes the cart line at once (`onChange(0)`): no confirm and no undo.

## apps/web/src/components/shop/checkout-address.tsx

apps/web/src/components/shop/checkout-address.tsx:113 - [Forms] recipient name, phone, province, ward and street controls have no `name` attribute (address autofill).

## apps/web/src/components/shop/checkout-screen.tsx

apps/web/src/components/shop/checkout-screen.tsx:470 - [Forms] voucher code input lacks `spellCheck={false}` (same for the staff referral code at :500).
apps/web/src/components/shop/checkout-screen.tsx:558 - [Forms] "Đặt hàng và thanh toán" is disabled while `quote === null` (after a quote failure) with no reason next to it; keep enabled and explain on submit.
apps/web/src/components/shop/checkout-screen.tsx:71 - [Forms] checkout (address, voucher, policy) has no unsaved-changes guard.
apps/web/src/components/shop/checkout-screen.tsx:449 - [Content Handling] a quote line with no cart match shows the raw `line.variantId` (a UUID) to the customer.

## apps/web/src/components/shop/order-fulfilment.tsx

apps/web/src/components/shop/order-fulfilment.tsx:66 - [Accessibility] tracking link opens a new tab with no new-tab hint.
apps/web/src/components/shop/order-fulfilment.tsx:72 - [Locale & i18n] carrier tracking code has no `translate="no"`.

## apps/web/src/components/shop/orders-screens.tsx

apps/web/src/components/shop/orders-screens.tsx:467 - [Typography] payment countdown ticks every second in `.ls-shop-state`, which has no `font-variant-numeric: tabular-nums` (pages-v2.css/site.css), so the line jitters.
apps/web/src/components/shop/orders-screens.tsx:171 - [Navigation & State] row menu "Xem đơn hàng" navigates with `router.push` (no link semantics).
apps/web/src/components/shop/orders-screens.tsx:203 - [Navigation & State] "Xem thêm" pages held in `useState`; lost on reload/Back.

## apps/web/src/components/shop/purchase-block.tsx

✓ pass

## apps/web/src/components/shop/quantity-stepper.tsx

✓ pass

## apps/web/src/components/shop/shop-data.ts

✓ pass

## apps/web/src/components/shop/shop-frame.tsx

✓ pass

## apps/web/src/components/navigation/page-back.tsx

✓ pass

## apps/web/src/components/notifications/inbox.tsx

apps/web/src/components/notifications/inbox.tsx:327 - [Navigation & State] category / view filters in `useState`; not reflected in the URL (not shareable, reset on reload/Back).
apps/web/src/components/notifications/inbox.tsx:396 - [Navigation & State] Archive acts immediately and the row menu offers no unarchive (archive only while `!archivedAt`): no undo.
apps/web/src/components/notifications/inbox.tsx:230 - [Content & Copy] the `title` of a linked message falls back to staff wording `t.open` ("Xem công việc" / "View work") for any source not listed (Booking, online order) whenever such an item links; the member inbox shares this table.

## apps/web/src/components/season/admin-season-chip.tsx

✓ pass

## apps/web/src/components/season/season-preview-stage.tsx

✓ pass

## apps/web/src/components/season/site-frame.tsx

✓ pass

## apps/web/src/components/season/site-frame-view.tsx

✓ pass

## apps/web/src/i18n/site.ts

apps/web/src/i18n/site.ts:381 - [Forms] chat placeholder "Nhập câu hỏi của bạn" (en :645 "Type your question") does not end with `…` and shows no example.
apps/web/src/i18n/site.ts:484 - [Typography] straight quotes `"{query}"` → `“{query}”` (en :747).
apps/web/src/i18n/site.ts:752 - [Content & Copy] "See the shop other services." is ungrammatical → "See the shop's other services." (same at :816 "the shop other products").
apps/web/src/i18n/site.ts:651 - [Content & Copy] "Leave a phone number, we call you back" is a comma splice in first person → "Leave your number and the shop will call you back".

## apps/web/src/i18n/customer.ts

apps/web/src/i18n/customer.ts:131 - [Typography] straight quotes `"bất kỳ"` → `“bất kỳ”` (en :428 `"any"`).
apps/web/src/i18n/customer.ts:180 - [Typography] straight quotes `"{query}"` (en :476).
apps/web/src/i18n/customer.ts:146 - [Typography] number + unit without non-breaking space: `'{minutes} phút'`, `'Dự kiến {minutes} phút'` (:126), en `'{minutes} min'` (:443, :423), `'{seconds} s'` (:365) can wrap between value and unit.
apps/web/src/i18n/customer.ts:10 - [Content & Copy] generic "Tiếp tục" / "Continue" (en :306) is the label of every booking step's primary button; name the next step ("Chọn khách", "Chọn giờ").
apps/web/src/i18n/customer.ts:271 - [Content & Copy] fallback error "Đã có lỗi xảy ra. Vui lòng thử lại." / "Something went wrong. Please try again." (en :567) is vague: no cause, no alternative (hotline).
apps/web/src/i18n/customer.ts:278 - [Content & Copy] "Không tìm thấy." / "Not found." (en :574) gives no next step.

## apps/web/src/i18n/customer-loyalty.ts

apps/web/src/i18n/customer-loyalty.ts:29 - [Locale & i18n] amount hand-written in copy: "1.000đ" (en :145 "1,000đ") with "đ" while every other amount uses Intl + "₫"; pass the amount through `formatVnd`.

## apps/web/src/i18n/customer-profile.ts

✓ pass

## apps/web/src/i18n/customer-review.ts

✓ pass

## apps/web/src/i18n/online-shop.ts

apps/web/src/i18n/online-shop.ts:470 - [Content & Copy] "We received your payment." switches to first person; the rest of the shop copy says "the shop" ("The shop received your payment.", :426).

## apps/web/src/i18n/campaigns-public.ts

✓ pass

## apps/web/src/i18n/notifications.ts

✓ pass (the staff-wording fallback is reported at its use, inbox.tsx:230)

## apps/web/src/i18n/season.ts

✓ pass
